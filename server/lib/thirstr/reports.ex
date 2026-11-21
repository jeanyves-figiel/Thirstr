defmodule Thirstr.Reports do
  @moduledoc """
  F-15 reports (R-15.9) with message franking (R-07.11), community auto-quarantine (R-15.7),
  beta auto-hide on severe reports (R-15.13), enforcement notices and appeals (R-15.14, R-AD.9).

  A report holds only what the reporter chose to attach. Attached chat messages are kept only when
  their franking commitment matches a tag the server stored at delivery from the reported profile to
  the reporter, so nobody can fabricate messages in a report.
  """
  alias Thirstr.{Moderation, Nearby, Repo}
  alias Thirstr.Accounts.Account

  @reasons ~w(spam_bot scam underage harassment non_consensual hate impersonation other)
  # A-01 order: minor safety, violence/non-consensual, scam, harassment/hate, spam, other
  @severity %{
    "underage" => 1,
    "non_consensual" => 2,
    "scam" => 3,
    "harassment" => 4,
    "hate" => 4,
    "impersonation" => 5,
    "spam_bot" => 5,
    "other" => 6
  }
  @contexts ~w(profile chat photo party tonight)
  @max_messages 20

  def reasons, do: @reasons
  def severity(reason), do: Map.fetch!(@severity, reason)

  @doc "POST /reports {profile_id, reason, context, note?, messages?: [{plain, fk}]} (S-50)."
  def create(%Account{} = a, params) do
    reason = params["reason"]
    context = params["context"] || "profile"
    note = params["note"] && String.slice(String.trim(to_string(params["note"])), 0, 500)

    with :ok <- check(reason in @reasons, :reason, "pick a reason"),
         :ok <- check(context in @contexts, :context, "unknown context"),
         {:ok, t} <- target(params["profile_id"]),
         :ok <- check(t.account_id != a.id, :profile_id, "you can't report yourself"),
         {:ok, franked} <- franked(a, t.id, params["messages"] || []) do
      Repo.query!(
        """
        INSERT INTO reports (id, reporter_account, target_account, target_profile, reason, context, note,
                             franked, severity, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now())
        ON CONFLICT (reporter_account, target_account, reason) WHERE state = 'open' DO UPDATE
          SET note = coalesce(EXCLUDED.note, reports.note),
              franked = coalesce(EXCLUDED.franked, reports.franked)
        """,
        [
          Nearby.dump(a.id),
          Nearby.dump(t.account_id),
          Nearby.dump(t.id),
          reason,
          context,
          blank(note),
          if(franked == [], do: nil, else: %{"messages" => franked}),
          severity(reason)
        ]
      )

      escalate(t.account_id, reason)
      {:ok, %{attached: length(franked)}}
    end
  end

  # Any non-deleted profile can be reported, including ones already hidden from the reporter.
  defp target(id) when is_binary(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{rows: [[pid, aid]]} <-
           Repo.query!(
             "SELECT p.id::text, a.id::text FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1 AND a.status <> 'deleted'",
             [Nearby.dump(id)]
           ) do
      {:ok, %{id: pid, account_id: aid}}
    else
      _ -> {:error, :not_found}
    end
  end

  defp target(_), do: {:error, :not_found}

  # R-07.11: tag = HMAC-SHA256(fk, plaintext); must match a tag stored for (reported → one of mine).
  defp franked(_a, _target, list) when not is_list(list) or length(list) > @max_messages,
    do: {:error, {:validation, %{messages: ["up to #{@max_messages} messages"]}}}

  defp franked(a, target, list) do
    mine =
      Repo.query!("SELECT id FROM profiles WHERE account_id = $1", [Nearby.dump(a.id)]).rows
      |> List.flatten()

    out =
      Enum.flat_map(list, fn m ->
        with %{"plain" => p, "fk" => k} <- m,
             {:ok, plain} <- Base.decode64(p),
             {:ok, fk} <- Base.decode64(k),
             tag = :crypto.mac(:hmac, :sha256, fk, plain),
             true <- tagged?(tag, target, mine),
             {:ok, w} <- Jason.decode(plain) do
          [summary(w)]
        else
          _ -> []
        end
      end)

    {:ok, out}
  end

  defp tagged?(tag, target, mine) do
    Repo.query!(
      "SELECT 1 FROM franking_tags WHERE tag = $1 AND from_profile_id = $2 AND to_profile_id = ANY($3)",
      [tag, Nearby.dump(target), mine]
    ).num_rows > 0
  end

  # Only what a moderator needs: kind, text, time. Media keys and ids are dropped.
  defp summary(w) do
    %{
      "t" => w["t"],
      "text" => is_binary(w["text"]) && String.slice(w["text"], 0, 2000),
      "at" => w["at"]
    }
  end

  # R-15.7 community quarantine and R-15.13 beta auto-hide (decisions.md).
  defp escalate(target_account, reason) do
    {bot, severe} =
      case Repo.query!(
             """
             SELECT count(DISTINCT r.reporter_account) FILTER (WHERE r.reason IN ('spam_bot', 'scam')
                                                              AND a.verified_at IS NOT NULL
                                                              AND r.created_at > now() - interval '24 hours'),
                    count(DISTINCT r.reporter_account) FILTER (WHERE r.severity <= 3)
             FROM reports r JOIN accounts a ON a.id = r.reporter_account
             WHERE r.target_account = $1 AND r.state = 'open'
             """,
             [Nearby.dump(target_account)]
           ).rows do
        [[b, s]] -> {b, s}
        _ -> {0, 0}
      end

    if bot >= 3 or severe >= 2 do
      case Repo.get(Account, target_account) do
        %Account{} = t -> Moderation.auto_quarantine(t, "reports:" <> reason)
        _ -> :ok
      end
    end

    :ok
  end

  # ------------------------------------------------------------------ notices & appeals (R-AD.9)

  @visible ~w(warn remove_photo hide_field suspend ban)

  @doc "GET /me/notices: enforcement notices with rule and appeal state. Quarantine is never shown."
  def notices(%Account{} = a) do
    rows =
      Repo.query!(
        """
        SELECT id::text, action, reason, created_at, ends_at, appeal_state, seen
        FROM moderation_actions WHERE target_account = $1 AND action = ANY($2)
        ORDER BY created_at DESC LIMIT 50
        """,
        [Nearby.dump(a.id), @visible]
      ).rows
      |> Nearby.utc()

    %{
      notices:
        Enum.map(rows, fn [id, act, reason, at, ends, appeal, seen] ->
          %{
            id: id,
            action: act,
            reason: reason,
            at: at,
            ends_at: ends,
            appeal: appeal,
            seen: seen
          }
        end)
    }
  end

  def seen(%Account{} = a) do
    Repo.query!("UPDATE moderation_actions SET seen = true WHERE target_account = $1", [
      Nearby.dump(a.id)
    ])

    :ok
  end

  @doc "POST /me/notices/:id/appeal {text}: one appeal per action (R-15.14)."
  def appeal(%Account{} = a, id, params) do
    text = String.slice(String.trim(to_string(params["text"] || "")), 0, 1000)

    with {:ok, _} <- Ecto.UUID.cast(id),
         :ok <- check(text != "", :text, "tell us what happened") do
      case Repo.query!(
             """
             UPDATE moderation_actions SET appeal_state = 'open', appeal_text = $3
             WHERE id = $1 AND target_account = $2 AND appeal_state IS NULL AND action = ANY($4)
             """,
             [Nearby.dump(id), Nearby.dump(a.id), text, @visible]
           ).num_rows do
        1 -> :ok
        _ -> {:error, {:conflict, "Already appealed"}}
      end
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  defp check(true, _f, _m), do: :ok
  defp check(_, f, m), do: {:error, {:validation, %{f => [m]}}}
  defp blank(""), do: nil
  defp blank(x), do: x
end
