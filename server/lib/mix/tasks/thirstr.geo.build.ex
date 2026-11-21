defmodule Mix.Tasks.Thirstr.Geo.Build do
  @shortdoc "Builds the offline IP → city file from a DB-IP City Lite CSV (#26)"
  @moduledoc """
      mix thirstr.geo.build dbip-city-lite.csv[.gz] priv/geo/city.tgeo

  Run at image build time (server/Dockerfile). No network access, no app start.
  """
  use Mix.Task
  alias Thirstr.Geo.GeoDbBuilder

  @impl true
  def run([input, output]) do
    modes = if String.ends_with?(input, ".gz"), do: [:compressed], else: []
    File.mkdir_p!(Path.dirname(output))

    counts =
      input
      |> File.stream!(modes, :line)
      |> Stream.map(&GeoDbBuilder.parse_line/1)
      |> GeoDbBuilder.build(output)

    Mix.shell().info("geo: #{inspect(counts)} → #{output} (#{File.stat!(output).size} bytes)")
  end

  def run(_), do: Mix.raise("usage: mix thirstr.geo.build INPUT.csv[.gz] OUTPUT.tgeo")
end
