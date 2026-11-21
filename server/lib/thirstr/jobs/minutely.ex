defmodule Thirstr.Jobs.Minutely do
  @moduledoc """
  Every minute: R-05.2 k-anonymity display resolution; expiry of Now status (AC-09.1: gone
  from the API ≤ 1 min after expiry, queries also filter on expires_at).
  """
  use Oban.Worker, queue: :maintenance, unique: [period: 50]

  @impl true
  def perform(_job) do
    Thirstr.Location.refresh_k_anonymity()
    Thirstr.Repo.query!("DELETE FROM now_status WHERE expires_at < now()")
    # B3 expiries: plans/posts (AC-09.1 also filtered by queries), venue auto check-out (R-12.6)
    Thirstr.Tonight.sweep()
    Thirstr.Activities.sweep()
    Thirstr.Venues.sweep()
    Thirstr.Moderation.sweep()
    Thirstr.Safety.sweep()
    :ok
  end
end
