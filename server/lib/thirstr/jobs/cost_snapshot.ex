defmodule Thirstr.Jobs.CostSnapshot do
  @moduledoc """
  Daily (EN-21 #180, admin-console.md A-11): usage counts, Fly run-rate from the Machines API,
  then the budget alert check (R-AD.14). A Fly failure keeps yesterday's rows and still checks
  the budget with what is known.
  """
  use Oban.Worker, queue: :maintenance, unique: [period: 3600]

  @impl true
  def perform(_job) do
    Thirstr.Costs.snapshot_usage()
    Thirstr.Costs.snapshot_fly()
    Thirstr.Costs.check_alerts()
    :ok
  end
end
