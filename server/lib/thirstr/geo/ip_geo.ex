defmodule Thirstr.Geo.IpGeo do
  @moduledoc """
  Approximate IP → city for the Welcome screen (R-02.2). Must run locally
  (no third-party lookup); the IP is never stored.
  """
  @callback city_for_ip(:inet.ip_address()) :: {:ok, String.t()} | :unknown
  def impl, do: Application.fetch_env!(:thirstr, :ip_geo)
end

defmodule Thirstr.Geo.StaticIpGeo do
  @moduledoc """
  Placeholder until an offline GeoLite-style DB is bundled (tracked in GitHub):
  returns the DEV default city (env `WELCOME_DEFAULT_CITY`, default Zurich).
  """
  @behaviour Thirstr.Geo.IpGeo
  @impl true
  def city_for_ip(_ip), do: {:ok, System.get_env("WELCOME_DEFAULT_CITY", "Zurich")}
end
