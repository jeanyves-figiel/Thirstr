defmodule ThirstrWeb.PublicController do
  @moduledoc "Unauthenticated read endpoints: health, Welcome counts (R-02.2), city picker (S-04b)."
  use ThirstrWeb, :controller
  alias Thirstr.Location
  alias Thirstr.Geo.IpGeo

  def health(conn, _) do
    Ecto.Adapters.SQL.query!(Thirstr.Repo, "SELECT 1")

    json(conn, %{
      ok: true,
      version: Application.spec(:thirstr, :vsn) |> to_string(),
      release: System.get_env("RELEASE_SHA", "dev")
    })
  end

  @doc "EN-13/EN-14: flags, kill switches and minimum build for this client (no account needed)."
  def config(conn, _) do
    conn
    |> put_resp_header("cache-control", "private, max-age=60")
    |> json(Thirstr.Flags.client_config(conn.assigns[:client] || %{}))
  end

  def welcome(conn, _) do
    city =
      case IpGeo.impl().city_for_ip(conn.remote_ip) do
        {:ok, c} -> c
        :unknown -> nil
      end

    json(
      conn,
      if(city, do: Location.welcome(city), else: %{city: nil, center: nil, count: nil, cells: []})
    )
  end

  def cities(conn, params), do: json(conn, %{cities: Location.search_cities(params["q"])})

  # F-14 R-14.1a: one file, identical for every client, so serving it reveals nothing about anyone.
  @safe_mode_path Path.expand("../../../priv/safe_mode/countries.json", __DIR__)
  @external_resource @safe_mode_path
  @safe_mode File.read!(@safe_mode_path)

  def safe_mode_countries(conn, _) do
    conn
    |> put_resp_content_type("application/json")
    |> put_resp_header("cache-control", "public, max-age=21600")
    |> send_resp(200, @safe_mode)
  end
end
