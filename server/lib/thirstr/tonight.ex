defmodule Thirstr.Tonight do
  @moduledoc """
  F-09 Tonight board (S-13): plans for tonight within ~10 km (widened when sparse),
  verified posters only (AC-09.2), max 2 active, expiry 06:00 local or window end + 1 h
  (R-09.11). Expired plans are filtered by every query (AC-09.1).
  """
  alias Thirstr.{Nearby, Repo, Social}
  alias Thirstr.Moderation.Text

  @tags ~w(hosting can_travel drinks_first party other)
  @audiences ~w(verified chats)
  @near_m 10_000
  @far_m 25_000
  @sparse 5

  def tags, do: @tags

  @doc "GET /tonight?mode&from&to — plans overlapping [from, to]."
  def list(ctx, params) do
    if is_nil(ctx.point) do
      {:ok, %{plans: [], mine: mine(ctx)}}
    else
      from = parse_time(params["from"]) || DateTime.utc_now()
      to = parse_time(params["to"]) || DateTime.add(from, 4 * 3600, :second)

      rows =
        Repo.query!(
          """
          SELECT t.id::text, t.profile_id::text, t.window_start, t.window_end, t.text, t.tag,
                 t.audience, t.cell_r8, a.id::text
          FROM tonight_plans t
          JOIN profiles p ON p.id = t.profile_id
          JOIN accounts a ON a.id = p.account_id
          WHERE t.cell_r5 = ANY($1) AND t.expires_at > now() AND $2::text = ANY(p.show_in)
            AND t.window_start < $4 AND t.window_end > $3
            AND a.status = 'active' AND a.id <> $5
          ORDER BY t.window_start
          LIMIT 500
          """,
          [Nearby.area(ctx, 2), ctx.lens, from, to, Nearby.dump(ctx.account.id)]
        ).rows
        |> Nearby.utc()
        |> Nearby.utc()

      partners = Nearby.chat_partners(ctx, Enum.map(rows, &Enum.at(&1, 1)))

      rows =
        rows
        |> Enum.filter(fn [_, pid, _, _, _, _, aud | _] ->
          (aud == "verified" and ctx.verified) or (aud == "chats" and pid in partners)
        end)
        |> tap(&Nearby.warm(Enum.map(&1, fn r -> Enum.at(r, 7) end)))
        |> Enum.map(fn [id, pid, ws, we, text, tag, aud, cell, _] ->
          %{
            id: id,
            pid: pid,
            ws: ws,
            we: we,
            text: text,
            tag: tag,
            aud: aud,
            d: Nearby.dist_m(ctx, cell)
          }
        end)

      near = Enum.filter(rows, &(&1.d <= @near_m))
      rows = if length(near) >= @sparse, do: near, else: Enum.filter(rows, &(&1.d <= @far_m))
      people = Nearby.people(ctx, Enum.map(rows, & &1.pid))

      plans =
        rows
        |> Enum.filter(&Map.has_key?(people, &1.pid))
        |> Enum.map(&json(&1, people[&1.pid]))

      {:ok, %{plans: plans, mine: mine(ctx)}}
    end
  end

  defp json(r, person) do
    %{
      id: r.id,
      profile: person,
      distance: Nearby.bucket(r.d),
      text: r.text,
      tag: r.tag,
      audience: r.aud,
      window_start: r.ws,
      window_end: r.we
    }
  end

  defp mine(%{profile_id: nil}), do: []

  defp mine(ctx) do
    Repo.query!(
      """
      SELECT id::text, window_start, window_end, text, tag, audience, expires_at FROM tonight_plans
      WHERE profile_id = $1 AND expires_at > now() ORDER BY window_start
      """,
      [Nearby.dump(ctx.profile_id)]
    ).rows
    |> Nearby.utc()
    |> Nearby.utc()
    |> Enum.map(fn [id, ws, we, text, tag, aud, exp] ->
      %{
        id: id,
        window_start: ws,
        window_end: we,
        text: text,
        tag: tag,
        audience: aud,
        expires_at: exp
      }
    end)
  end

  @doc "POST /tonight (R-09.9)."
  def create(ctx, params) do
    text = String.trim(params["text"] || "")
    ws = parse_time(params["window_start"])
    we = parse_time(params["window_end"])
    tz = params["tz_offset_min"]
    now = DateTime.utc_now()

    with :ok <- Social.require_verified(ctx.account),
         :ok <- Nearby.require_profile(ctx),
         :ok <- Nearby.require_point(ctx),
         :ok <- check(ctx.kind != "sport", :mode, "use activities in Sport mode"),
         :ok <-
           check(
             String.length(text) <= 140,
             :text,
             "max 140 characters (optional, required-fields.md RF-13)"
           ),
         :ok <-
           check(
             not (Text.contact_details?(text) or Text.link?(text)),
             :text,
             "no links or contact details"
           ),
         :ok <- check(params["tag"] in @tags, :tag, "invalid"),
         :ok <- check((params["audience"] || "verified") in @audiences, :audience, "invalid"),
         :ok <- check(is_integer(tz) and tz >= -720 and tz <= 840, :tz_offset_min, "invalid"),
         :ok <- check(ws && we && DateTime.compare(we, ws) == :gt, :window_end, "after start"),
         :ok <- check(DateTime.diff(ws, now) > -3600, :window_start, "in the past"),
         expires = expiry(ws, we, tz),
         :ok <- check(DateTime.compare(ws, expires) == :lt, :window_start, "tonight only"),
         :ok <- check(active_count(ctx.profile_id) < 2, :plans, "max 2 active plans") do
      id = Ecto.UUID.generate()

      Repo.query!(
        """
        INSERT INTO tonight_plans (id, profile_id, window_start, window_end, text, tag, audience,
                                   cell_r8, cell_r5, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        """,
        [
          Nearby.dump(id),
          Nearby.dump(ctx.profile_id),
          ws,
          we,
          text,
          params["tag"],
          params["audience"] || "verified",
          Nearby.cell(ctx.point, 8),
          ctx.r5,
          expires
        ]
      )

      {:ok, %{id: id, expires_at: expires}}
    end
  end

  @doc "R-09.11: the earlier of 06:00 local after the window start, or window end + 1 h."
  def expiry(ws, we, tz) do
    local = DateTime.add(ws, tz * 60, :second)
    six = %{local | hour: 6, minute: 0, second: 0, microsecond: {0, 6}}

    six =
      if DateTime.compare(local, six) == :lt, do: six, else: DateTime.add(six, 86_400, :second)

    six_utc = DateTime.add(six, -tz * 60, :second)
    plus = DateTime.add(we, 3600, :second)
    if DateTime.compare(six_utc, plus) == :lt, do: six_utc, else: plus
  end

  defp active_count(pid) do
    [[n]] =
      Repo.query!(
        "SELECT count(*) FROM tonight_plans WHERE profile_id = $1 AND expires_at > now()",
        [Nearby.dump(pid)]
      ).rows
      |> Nearby.utc()
      |> Nearby.utc()

    n
  end

  def delete(ctx, id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} ->
        Repo.query!(
          "DELETE FROM tonight_plans WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE account_id = $2)",
          [Nearby.dump(id), Nearby.dump(ctx.account.id)]
        )

        :ok

      _ ->
        {:error, :not_found}
    end
  end

  def sweep do
    Repo.query!("DELETE FROM tonight_plans WHERE expires_at < now() - interval '1 hour'")
  end

  def check(true, _f, _m), do: :ok
  def check(_, f, m), do: {:error, {:validation, %{f => [m]}}}

  def parse_time(nil), do: nil

  def parse_time(s) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, d, _} -> d
      _ -> nil
    end
  end

  def parse_time(_), do: nil
end
