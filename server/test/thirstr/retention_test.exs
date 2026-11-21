defmodule Thirstr.RetentionTest do
  use Thirstr.DataCase, async: false
  alias Thirstr.{Repo, Retention}

  # EN-17 (#176): every rule's probe runs (tables and columns exist) and sees overdue rows.
  test "all probes run and are 0 on a clean database" do
    assert Enum.sort(Retention.rules()) ==
             Retention.overdue() |> Enum.map(&elem(&1, 0)) |> Enum.sort()

    assert Enum.all?(Retention.overdue(), fn {_, n} -> n == 0 end)
  end

  test "an error group the sweep missed shows up, then the sweep clears it" do
    Repo.query!("""
    INSERT INTO client_errors (signature, platform, message, first_seen, last_seen)
    VALUES ('s', 'ios', 'm', now() - interval '40 days', now() - interval '40 days')
    """)

    assert {"client_errors_30d", 1} in Retention.overdue()
    Thirstr.ClientErrors.sweep()
    assert {"client_errors_30d", 0} in Retention.overdue()
  end

  test "telemetry event per rule" do
    ref = :telemetry_test.attach_event_handlers(self(), [[:thirstr, :retention]])
    Retention.measure()
    assert_receive {[:thirstr, :retention], ^ref, %{overdue: 0}, %{rule: "ciphertext_30d"}}
  end
end
