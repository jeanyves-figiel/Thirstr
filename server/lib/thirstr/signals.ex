defmodule Thirstr.Signals do
  @moduledoc """
  F-15 R-15.5 metadata-only bot signals. Counters live in Valkey (24 h windows); the
  quarantine decision (R-15.6) reads them. No content is ever recorded.
  """
  alias Thirstr.Accounts.Account
  alias Thirstr.Valkey

  @window 24 * 3600
  # signal => count within 24 h that triggers quarantine review
  @thresholds %{velocity: 3, first_msg_dupe: 5, link_attempt: 5, unattested: 1_000_000}

  def record(%Account{id: id} = a, signal) when is_map_key(@thresholds, signal) do
    key = "sig:#{signal}:#{id}"
    {:ok, n} = Valkey.hit(key, 1_000_000, @window)

    if n >= @thresholds[signal] do
      Thirstr.Moderation.auto_quarantine(a, "signal:#{signal}")
    end

    :ok
  end

  def count(%Account{id: id}, signal) do
    case Valkey.command!(["GET", "sig:#{signal}:#{id}"]) do
      nil -> 0
      n -> String.to_integer(n)
    end
  end
end
