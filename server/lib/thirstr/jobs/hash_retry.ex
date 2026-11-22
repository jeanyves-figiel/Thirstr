defmodule Thirstr.Jobs.HashRetry do
  @moduledoc """
  F-15 R-15.43 (#179): every 2 min, re-check public photos whose hash match failed (provider down).
  They stay `pending` (never visible) until a verdict; after 30 min they also go to A-03 for a person.
  """
  use Oban.Worker, queue: :maintenance, unique: [period: 100]

  @impl true
  def perform(_job) do
    Thirstr.Profiles.retry_hash_checks()
    :ok
  end
end
