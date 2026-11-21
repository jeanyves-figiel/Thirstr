defmodule Thirstr.Settings do
  @moduledoc """
  F-17 settings the server must enforce (R-17.2): visibility, message permissions, symmetry.
  Everything else (notifications, app lock, quick replies, theme…) is device-local and synced
  E2EE between own devices. Defaults are the safe defaults of R-17.3 / R-17.7.
  """
  alias Thirstr.Accounts.Account
  alias Thirstr.Repo

  @defaults %{
    # R-17.7 Hide from
    "hide_from_unverified" => true,
    "hide_from_new" => false,
    "hide_from_age_min" => nil,
    "hide_from_age_max" => nil,
    # profile-and-settings §3: show in surfaces
    "show_in_grid" => true,
    "show_in_map" => true,
    "show_in_tonight" => true,
    "show_in_activities" => true,
    "show_in_venues" => true,
    # F-20 R-17.14 (#188): travellers looking around from afar can see me
    "show_to_remote" => true,
    # exact (a rounded number, #197) | range (buckets only) | none
    "show_distance" => "exact",
    # #197 R-05.13 "Show closer distance" (Area at ~50 m), asked in onboarding
    "precise_distance" => false,
    # R-17.5 symmetry
    "online_visible" => true,
    "read_receipts" => true,
    # F-21 R-21.17 (#212): watch Moments quietly (views counted, never named; reciprocal)
    "moments_quiet" => false,
    # R-17.6 verified | tapped | filters
    "who_can_message" => "verified",
    # R-07.10 blur | allow | block
    "explicit_from_strangers" => "blur",
    # R-07.6 24h | 7d | never
    "disappearing_default" => "7d",
    # F-16 push (server needs type toggles + quiet hours to decide whether to wake)
    "push" => %{},
    "quiet_hours" => nil
  }

  @enums %{
    "show_distance" => ~w(exact range none),
    "who_can_message" => ~w(verified tapped filters),
    "explicit_from_strangers" => ~w(blur allow block),
    "disappearing_default" => ~w(24h 7d never)
  }

  def defaults, do: @defaults

  def get(%Account{settings: s}), do: Map.merge(@defaults, s || %{})
  def get(%Account{} = a, key), do: Map.get(get(a), key)

  def update(%Account{} = a, params) when is_map(params) do
    errors =
      params
      |> Enum.flat_map(fn {k, v} ->
        case validate(k, v) do
          :ok -> []
          {:error, m} -> [{k, [m]}]
        end
      end)
      |> Map.new()

    if errors == %{} do
      merged = Map.merge(a.settings || %{}, Map.take(params, Map.keys(@defaults)))
      a |> Ecto.Changeset.change(settings: merged) |> Repo.update()
    else
      {:error, {:validation, errors}}
    end
  end

  defp validate(k, v) when is_map_key(@enums, k),
    do: if(v in @enums[k], do: :ok, else: {:error, "invalid value"})

  defp validate(k, v) when k in ~w(hide_from_age_min hide_from_age_max),
    do: if(is_nil(v) or (is_integer(v) and v in 18..99), do: :ok, else: {:error, "18–99"})

  defp validate("precise_distance", v),
    do: if(is_boolean(v), do: :ok, else: {:error, "true or false"})

  defp validate("push", v) when is_map(v),
    do: if(Enum.all?(v, fn {_, b} -> is_boolean(b) end), do: :ok, else: {:error, "booleans"})

  defp validate("quiet_hours", nil), do: :ok

  defp validate("quiet_hours", %{"from" => f, "to" => t, "tz_offset_min" => o})
       when f in 0..23 and t in 0..23 and is_integer(o),
       do: :ok

  defp validate("quiet_hours", _), do: {:error, "invalid"}

  defp validate(k, v) when is_map_key(@defaults, k),
    do: if(is_boolean(v), do: :ok, else: {:error, "must be true or false"})

  defp validate(_, _), do: {:error, "unknown setting"}
end
