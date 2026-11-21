defmodule Thirstr.Jobs.PushWake do
  @moduledoc """
  Delivers one content-free wake-up per account (F-16). Retries APNs/FCM failures a retry can
  fix (429, 5xx, network) after 5 s, 15 s, 45 s, 2 min (SR-02). `unique` keeps the 20 s
  throttle (R-16.5) when Valkey is unreachable (SR-11).
  """
  use Oban.Worker,
    queue: :push,
    max_attempts: 5,
    unique: [period: 20, keys: [:account_id], states: [:available, :scheduled, :retryable]]

  @backoff [5, 15, 45, 120]

  @impl true
  def perform(%Oban.Job{args: %{"account_id" => id, "event" => event}}) do
    Thirstr.Push.deliver(id, event)
  end

  @impl true
  def backoff(%Oban.Job{attempt: n}), do: Enum.at(@backoff, n - 1, 120)
end
