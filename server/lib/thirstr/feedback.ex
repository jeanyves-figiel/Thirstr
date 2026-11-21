defmodule Thirstr.Feedback do
  @moduledoc """
  F-22 R-22.30–R-22.34 (#178): in-app feedback becomes an anonymous GitHub issue.

  The text is scrubbed (Support.Scrub) before it is stored, then a job files the issue with a token
  that can only write issues on one repo. The issue never carries account, profile or device ids,
  IP, location, email or the time beyond the date. Once the issue exists the text is deleted; the
  row (date, issue number) goes after 30 days. Held texts (slurs, self-harm) stay for the admin.
  """
  import Ecto.Query, only: [from: 2]
  alias Thirstr.{Nearby, Repo, Valkey}
  alias Thirstr.Accounts.Account
  alias Thirstr.Support.Scrub

  @kinds %{"idea" => "Idea", "off" => "Something's off", "love" => "I love this"}
  @parts ~w(explore chats profile location safety plans other)
  @per_day 5

  def create(%Account{} = a, params) do
    kind = params["type"]
    part = params["part"]
    text = params["text"] |> to_string_safe() |> String.trim()

    with :ok <- check(Map.has_key?(@kinds, kind), :type, "idea, off or love"),
         :ok <- check(is_nil(part) or part in @parts, :part, "unknown part"),
         :ok <- check(String.length(text) in 10..1000, :text, "10 to 1000 characters"),
         :ok <- check(old_enough?(a), :account, "new accounts can send feedback after a day"),
         {:ok, _} <- limit(a) do
      scrubbed = text |> Scrub.scrub(names(a)) |> String.slice(0, 1000)
      hash = :crypto.hash(:sha256, String.downcase(scrubbed))

      dup? =
        Repo.exists?(
          from(f in "feedback",
            where: f.text_hash == ^hash and fragment("? > current_date - 7", f.created_on)
          )
        )

      unless dup? do
        id = Ecto.UUID.generate()
        state = if Scrub.hold?(scrubbed), do: "held", else: "queued"

        Repo.insert_all("feedback", [
          %{
            id: Nearby.dump(id),
            kind: kind,
            part: part,
            text_scrubbed: scrubbed,
            text_hash: hash,
            app: app(params["app"]),
            state: state
          }
        ])

        if state == "queued",
          do: %{id: id} |> Thirstr.Jobs.FeedbackIssue.new() |> Oban.insert()
      end

      :ok
    end
  end

  @doc "Issue title + body for one feedback row (pure, tested)."
  def issue(%{kind: kind, part: part, text: text, app: app, id: id, date: date}) do
    first = text |> String.replace(~r/\s+/u, " ") |> String.slice(0, 60)
    app = app || %{}

    body = """
    #{text}

    ---
    type: #{kind} · part: #{part || "—"}
    app: #{app["version"] || "?"} · #{app["platform"] || "?"} #{app["os"] || ""} · lang: #{app["lang"] || "?"}
    id: fb-#{String.slice(String.replace(id, "-", ""), 0, 8)} · #{Date.to_iso8601(date)}

    _Sent from the app, scrubbed of personal data (F-22 R-22.31). No account, device or IP attached._
    """

    %{
      title: "[Feedback] #{@kinds[kind]}: #{first}",
      body: body,
      labels: ["feedback", "from-app", "fb:#{kind}"] ++ if(part, do: ["area:#{part}"], else: [])
    }
  end

  @doc "Job body: files the issue, then forgets the text. {:error, _} retries; gives up after 24 h."
  def file(id) do
    case Repo.query!(
           "SELECT kind, part, text_scrubbed, app, created_on, created_at FROM feedback WHERE id = $1 AND state = 'queued'",
           [Nearby.dump(id)]
         ).rows do
      [[kind, part, text, app, date, at]] when is_binary(text) ->
        if DateTime.diff(DateTime.utc_now(), at, :hour) >= 24 do
          drop(id)
        else
          post(id, issue(%{kind: kind, part: part, text: text, app: app, id: id, date: date}))
        end

      _ ->
        :ok
    end
  end

  defp post(id, %{title: t, body: b, labels: l}) do
    cfg = Application.get_env(:thirstr, :feedback_github, [])

    case {cfg[:token], cfg[:repo]} do
      {tok, repo} when is_binary(tok) and tok != "" and is_binary(repo) ->
        res =
          Req.post("https://api.github.com/repos/#{repo}/issues",
            json: %{title: t, body: b, labels: l},
            headers: [
              {"authorization", "Bearer " <> tok},
              {"accept", "application/vnd.github+json"},
              {"x-github-api-version", "2022-11-28"},
              {"user-agent", "thirstr-feedback"}
            ],
            retry: false,
            receive_timeout: 15_000
          )

        case res do
          {:ok, %{status: 201, body: %{"number" => n}}} ->
            Repo.query!(
              "UPDATE feedback SET state = 'filed', issue_number = $2, text_scrubbed = NULL WHERE id = $1",
              [Nearby.dump(id), n]
            )

            :telemetry.execute([:thirstr, :feedback, :filed], %{count: 1}, %{})
            :ok

          other ->
            {:error, {:github, status(other)}}
        end

      _ ->
        {:error, :not_configured}
    end
  end

  defp status({:ok, %{status: s}}), do: s
  defp status(_), do: :network

  defp drop(id) do
    Repo.query!(
      "UPDATE feedback SET state = 'dropped', text_scrubbed = NULL WHERE id = $1",
      [Nearby.dump(id)]
    )

    :telemetry.execute([:thirstr, :feedback, :dropped], %{count: 1}, %{})
    :ok
  end

  @doc "Admin: held feedback (A-12)."
  def held do
    Repo.query!(
      "SELECT id::text, kind, part, text_scrubbed, created_on FROM feedback WHERE state = 'held' ORDER BY created_at LIMIT 100",
      []
    ).rows
  end

  @doc "Admin: send a held text on, or delete it."
  def release(id, :send) do
    Repo.query!(
      "UPDATE feedback SET state = 'queued', created_at = now() WHERE id = $1 AND state = 'held'",
      [
        Nearby.dump(id)
      ]
    )

    %{id: id} |> Thirstr.Jobs.FeedbackIssue.new() |> Oban.insert()
    :ok
  end

  def release(id, :delete) do
    Repo.query!("DELETE FROM feedback WHERE id = $1", [Nearby.dump(id)])
    :ok
  end

  @doc "Retention: rows older than 30 days; held texts too."
  def sweep do
    %{num_rows: n} =
      Repo.query!("DELETE FROM feedback WHERE created_on < current_date - 30", [])

    n
  end

  defp names(%Account{id: aid}) do
    Repo.query!("SELECT display_name FROM profiles WHERE account_id = $1", [Nearby.dump(aid)]).rows
    |> List.flatten()
  end

  defp old_enough?(%Account{inserted_at: %{} = t}),
    do: DateTime.diff(DateTime.utc_now(), to_dt(t), :hour) >= 24

  defp old_enough?(_), do: true

  defp to_dt(%DateTime{} = d), do: d
  defp to_dt(%NaiveDateTime{} = n), do: DateTime.from_naive!(n, "Etc/UTC")

  defp limit(a) do
    case Valkey.hit("fb:" <> a.id, @per_day, 86_400) do
      {:ok, n} -> {:ok, n}
      {:error, :rate_limited, r} -> {:error, {:rate_limited, r}}
    end
  end

  defp app(m) when is_map(m) do
    m
    |> Map.take(~w(version platform os lang))
    |> Map.new(fn {k, v} -> {k, if(is_binary(v), do: String.slice(v, 0, 20), else: nil)} end)
  end

  defp app(_), do: nil

  defp check(true, _, _), do: :ok
  defp check(_, f, m), do: {:error, {:validation, %{f => [m]}}}
  defp to_string_safe(s) when is_binary(s), do: s
  defp to_string_safe(_), do: ""
end
