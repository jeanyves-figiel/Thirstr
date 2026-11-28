defmodule Thirstr.Plus do
  @moduledoc """
  F-23 Thirstr Plus (#7, decision D-25): who has Plus and the Free / Plus limits.

  Sources, first match wins (R-23.4): `lifetime` > `store` > `grant` > `safe_mode` > `beta`.
  - `beta` (R-23.1): every account while billing is off (flag `plus_billing`, default off).
  - `safe_mode` (R-23.2): Safe Mode on or active. The server never learns the country (R-14.3).
  - `store` / `lifetime` / `grant` (R-23.3): one active row in `plus_entitlements`.

  `limits/1` is the only place the numbers live (R-23.5); `/me` sends them to the app.
  Abuse caps that apply to everyone (parties 3 a day, trips 6 creates / 30 d …) stay in their
  own modules.
  """
  alias Thirstr.Accounts.Account
  alias Thirstr.{Flags, Repo}

  @free %{
    nearby: 200,
    distance_km: 100,
    party_per_week: 1,
    party_capacity: 10,
    party_cohosts: 0,
    party_recurring: false,
    trips: 1,
    look_around_any_city: false,
    tonight_active: 1,
    moments_per_day: 3,
    moments_live: 3,
    moments_48h: false,
    album_bytes: 1_000_000_000,
    video_seconds: 180,
    translate: false,
    friend_alerts: 20,
    filter_presets: 0,
    chat_folders: 0,
    extras: false,
    views_list: false,
    # F-25 (#339, D-26): Refill cards, after-date rating, Me › Refill
    refill: false
  }

  # nil = no Plus limit (the shared abuse caps still apply).
  @plus %{
    nearby: nil,
    distance_km: 300,
    party_per_week: nil,
    party_capacity: 40,
    party_cohosts: 3,
    party_recurring: true,
    trips: 5,
    look_around_any_city: true,
    tonight_active: 3,
    moments_per_day: 20,
    moments_live: 10,
    moments_48h: true,
    album_bytes: 25_000_000_000,
    video_seconds: 600,
    translate: true,
    friend_alerts: 100,
    filter_presets: 10,
    chat_folders: 10,
    extras: true,
    views_list: true,
    refill: true
  }

  def free_limits, do: @free
  def plus_limits, do: @plus

  @doc "Billing on (open beta) or everyone-has-Plus (closed beta, R-23.1)."
  def billing?, do: Flags.enabled?("plus_billing")

  @doc "`%{active, source, product?, renews_at?, ends_at?, grace_until?}` for `/me`."
  def entitlement(%Account{} = a) do
    case store_row(a) do
      %{} = row ->
        %{
          active: true,
          source: if(row.product == "plus.lifetime", do: "lifetime", else: row.store_source),
          product: row.product,
          renews_at: row.state == "active" && row.product != "plus.lifetime" && row.period_end,
          grace_until: row.state == "grace" && row.period_end
        }
        |> Map.reject(fn {k, v} -> k != :active and v in [nil, false] end)

      nil ->
        cond do
          Account.safe_mode_on?(a) -> %{active: true, source: "safe_mode"}
          not billing?() -> %{active: true, source: "beta"}
          true -> %{active: false, source: "none"}
        end
    end
  end

  def plus?(%Account{} = a), do: entitlement(a).active

  def limits(%Account{} = a), do: if(plus?(a), do: @plus, else: @free)

  def limit(%Account{} = a, key), do: Map.fetch!(limits(a), key)

  @doc """
  Error for a reached limit (R-23.16): `{:plus_limit, key, free, plus, next_at, message}`.
  The fallback answers 422 `plus_limit` to apps that send `X-Thirstr-Plus: 1`, else the
  `validation` shape older builds understand.
  """
  def limit_error(key, message, next_at \\ nil),
    do: {:error, {:plus_limit, key, @free[key], @plus[key], next_at, message}}

  defp store_row(a) do
    case Repo.query!(
           """
           SELECT store, product, state, period_end FROM plus_entitlements
           WHERE account_id = $1 AND state IN ('active', 'grace')
             AND (period_end IS NULL OR period_end > now())
           ORDER BY (product = 'plus.lifetime') DESC, (store = 'grant') ASC
           LIMIT 1
           """,
           [Ecto.UUID.dump!(a.id)]
         ).rows do
      [[store, product, state, period_end]] ->
        %{
          store_source: if(store == "grant", do: "grant", else: "store"),
          product: product,
          state: state,
          period_end: period_end
        }

      [] ->
        nil
    end
  end
end
