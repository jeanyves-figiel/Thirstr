defmodule Thirstr.Trust do
  @moduledoc """
  F-18 badges and vouches. Vouches are anonymous counts (R-18.5) and never feed Explore
  ordering (R-18.6): they show only on profiles and party requests.
  """
  alias Thirstr.{Nearby, Repo}
  alias Thirstr.Accounts.Account

  @min_age_days 30
  @per_30d 5
  @min_messages 10

  @doc """
  Weighted vouch count, computed by the `vouch_count(profile)` SQL function (migration B4a):
  weight 1 for 6 months then linear to 0 at 12 (R-18.3), reciprocal pairs count half (R-18.4),
  capped at 20 shown (R-18.2).
  """
  def vouch_count(profile_id) do
    [[n]] = Repo.query!("SELECT vouch_count($1)", [Nearby.dump(profile_id)]).rows
    n
  end

  @doc "POST /profiles/:id/vouch (R-18.1, R-18.2, AC-18.1)."
  def vouch(%Account{} = a, profile_id) do
    with :ok <- Thirstr.Social.require_verified(a),
         :ok <- old_enough(a),
         {:ok, _} <- Ecto.UUID.cast(profile_id),
         :ok <- chatted(a, profile_id),
         :ok <- quota(a) do
      Repo.query!(
        "INSERT INTO vouches (from_account, to_profile, created_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING",
        [Nearby.dump(a.id), Nearby.dump(profile_id)]
      )

      {:ok, %{vouched: true}}
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  @doc "DELETE /profiles/:id/vouch: withdraw (R-18.5)."
  def unvouch(%Account{} = a, profile_id) do
    with {:ok, _} <- Ecto.UUID.cast(profile_id) do
      Repo.query!("DELETE FROM vouches WHERE from_account = $1 AND to_profile = $2", [
        Nearby.dump(a.id),
        Nearby.dump(profile_id)
      ])

      {:ok, %{vouched: false}}
    end
  end

  def vouched?(%Account{} = a, profile_id) do
    Repo.query!("SELECT 1 FROM vouches WHERE from_account = $1 AND to_profile = $2", [
      Nearby.dump(a.id),
      Nearby.dump(profile_id)
    ]).num_rows > 0
  end

  @doc "Can this account vouch for the profile? Drives the button on S-20."
  def can_vouch?(%Account{} = a, profile_id) do
    Account.verified?(a) and old_enough(a) == :ok and chatted(a, profile_id) == :ok
  end

  defp old_enough(a) do
    if DateTime.diff(DateTime.utc_now(), a.inserted_at, :day) >= @min_age_days,
      do: :ok,
      else: {:error, {:forbidden, "Accounts can vouch after 30 days"}}
  end

  # R-18.1 proxy for having met: ≥ 10 messages each way between one of mine and that profile.
  defp chatted(a, profile_id) do
    n =
      Repo.query!(
        """
        SELECT 1 FROM contacts c JOIN profiles m ON m.id IN (c.profile_a, c.profile_b)
        WHERE m.account_id = $1 AND $2 IN (c.profile_a, c.profile_b) AND m.id <> $2
          AND c.a_sent >= $3 AND c.b_sent >= $3
        """,
        [Nearby.dump(a.id), Nearby.dump(profile_id), @min_messages]
      ).num_rows

    if n > 0,
      do: :ok,
      else: {:error, {:forbidden, "Vouch for people you've really chatted with"}}
  end

  defp quota(a) do
    [[n]] =
      Repo.query!(
        "SELECT count(*) FROM vouches WHERE from_account = $1 AND created_at > now() - interval '30 days'",
        [Nearby.dump(a.id)]
      ).rows

    if n < @per_30d,
      do: :ok,
      else: {:error, {:forbidden, "You can vouch for 5 people every 30 days"}}
  end

  @doc "System badges (F-18 table). Vouches never feed Explore ordering (R-18.6)."
  def badges(t) do
    years = div(DateTime.diff(DateTime.utc_now(), t.inserted_at, :day), 365)

    [
      t.verified_at && %{kind: "verified", since: Calendar.strftime(t.verified_at, "%Y-%m")},
      %{kind: "member_since", years: years},
      host_rating(t.id)
    ]
    |> Enum.reject(&is_nil/1)
  end

  # Host rating: ≥ 3 party ratings across this profile's parties.
  defp host_rating(profile_id) do
    case Repo.query!(
           """
           SELECT count(*), count(*) FILTER (WHERE r.rating > 0)
           FROM party_requests r JOIN parties p ON p.id = r.party_id
           WHERE p.host_profile_id = $1 AND r.rating IS NOT NULL
           """,
           [Nearby.dump(profile_id)]
         ).rows do
      [[n, up]] when n >= 3 -> %{kind: "host_rating", up_pct: round(up * 100 / n), total: n}
      _ -> nil
    end
  end

  @doc false
  def repo, do: Repo
end
