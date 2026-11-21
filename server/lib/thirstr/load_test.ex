defmodule Thirstr.LoadTest do
  @moduledoc """
  SR-12 (#152): verified, located test accounts for the k6 load test (`infra/load/`). Runs only
  on a dedicated load environment (`DEPLOY_ENV=load`) or in DEV/test; refuses staging and prod.

      bin/thirstr rpc 'Thirstr.LoadTest.users(400) |> IO.puts()' > users.json
  """
  alias Thirstr.{Accounts, Ids, Onboarding, Repo}

  @cities [{47.3769, 8.5417}, {52.52, 13.405}, {48.8566, 2.3522}]

  def allowed? do
    case System.get_env("DEPLOY_ENV") do
      "load" -> true
      nil -> Application.get_env(:thirstr, :dev_routes, false)
      _ -> false
    end
  end

  @doc "Creates `n` accounts (pairs i, i^1 chat together) and returns their sessions as JSON."
  def users(n) when is_integer(n) and n > 0 and n <= 20_000 do
    unless allowed?(), do: raise("load test accounts only on DEPLOY_ENV=load or DEV")

    cells = cells()

    for i <- 0..(n - 1) do
      {:ok, a, _} =
        Accounts.find_or_create_by(
          :auth_oidc_hash,
          Ids.hash("oidc:load", "load-#{Ids.random_token(8)}"),
          age_confirmed: true
        )

      {:ok, _} =
        Onboarding.save_basics(
          a,
          %{
            "display_name" => "Load#{i}",
            "birthdate" => "1995-01-01",
            "gender" => "man",
            "here_for" => ["hookup", "chat"]
          },
          nil
        )

      {:ok, a} =
        Onboarding.set_location(a, %{"level" => "area", "cell_r9" => Enum.random(cells)})

      Repo.query!(
        "UPDATE accounts SET verified_at = now(), settings = settings || '{\"hide_from_unverified\": false}' WHERE id = $1",
        [Ecto.UUID.dump!(a.id)]
      )

      a = Accounts.get_account(a.id)
      {:ok, s} = Accounts.start_session(a, "ios")
      pid = Onboarding.main_profile(a).id
      %{i: i, token: s.access_token, refresh: s.refresh_token, device: s.device_id, pid: pid}
    end
    |> Jason.encode!()
  end

  # r9 cells within ~1.5 km of the seeded city centres (Thirstr.Seeds)
  defp cells do
    @cities
    |> Enum.flat_map(fn {lat, lng} ->
      Repo.query!(
        "SELECT h3_grid_disk(h3_lat_lng_to_cell(point($1::float8, $2::float8), 9), 6)::text",
        [lng, lat]
      ).rows
    end)
    |> List.flatten()
  end
end
