defmodule Thirstr.Jobs.PlaceImport do
  @moduledoc "F-12 R-12.9 (#113): weekly OSM venue import; admin console › Places › Import now."
  use Oban.Worker, queue: :maintenance, max_attempts: 2, unique: [period: 3600]

  alias Thirstr.Places.OsmImport

  @impl true
  def perform(%Oban.Job{}) do
    if OsmImport.enabled?(), do: OsmImport.run(), else: :ok
    :ok
  end

  @impl true
  def timeout(_job), do: :timer.minutes(40)
end
