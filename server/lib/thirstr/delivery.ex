defmodule Thirstr.Delivery do
  @moduledoc """
  EN-23 OB-1 (#343, docs/spec/delivery-latency-monitoring.md): content-free delivery signals.

  - Live devices: a `user:me` socket that joined with `env: true` joins the `:pg` group named
    after its device id (scope `#{inspect(:thirstr_live)}`), cluster-wide, gone when the socket
    process ends. A message stored for such a device is `live` (recipient online).
  - Push wake: after the provider accepts a push, `pw:<device>` in Valkey holds the send time
    (24 h). The device's next pull or socket join takes it → wake time. A newer push that finds
    an old key (> 15 min) counts the earlier push as `none` (did not wake the phone).
  - Stuck: unacked envelopes older than 2 min for devices with a live socket on this node.

  Metrics carry no ids; Valkey keys hold a device id only for at most 24 h and are never logged.
  """
  alias Thirstr.{Repo, Valkey}

  @scope :thirstr_live
  @wake_window_ms 15 * 60_000

  def child_spec(_), do: %{id: __MODULE__, start: {:pg, :start_link, [@scope]}}

  # ------------------------------------------------------------------ live sockets

  @doc "Called by the socket process that receives this device's envelopes."
  def join_live(device_id) when is_binary(device_id) do
    :pg.join(@scope, device_id, self())
  catch
    _, _ -> :ok
  end

  @doc "True when this device has a live envelope socket anywhere in the cluster."
  def live?(device_id) when is_binary(device_id) do
    :pg.get_members(@scope, device_id) != []
  catch
    _, _ -> false
  end

  def live?(_), do: false

  @doc "Device ids with a live envelope socket on this node."
  def local_live do
    :pg.which_groups(@scope) |> Enum.filter(&(:pg.get_local_members(@scope, &1) != []))
  catch
    _, _ -> []
  end

  # ------------------------------------------------------------------ chat events

  @doc "One send request: `result` = stored | repeat | dropped | limited | rejected."
  def send_result(result),
    do: :telemetry.execute([:thirstr, :chat, :send], %{count: 1}, %{result: result})

  def envelopes(kind, path, n) when n > 0,
    do: :telemetry.execute([:thirstr, :chat, :envelope], %{count: n}, %{kind: kind, path: path})

  def envelopes(_, _, _), do: :ok

  @doc "Insert → ack per acked envelope. `live` = recipient was online when stored."
  def delivered(path, live, ms) do
    :telemetry.execute([:thirstr, :chat, :delivery], %{duration_ms: max(ms, 0)}, %{
      path: path,
      recipient: if(live, do: "online", else: "offline")
    })
  end

  def skipped(0), do: :ok

  def skipped(n),
    do: :telemetry.execute([:thirstr, :chat, :skipped], %{count: n}, %{})

  def expired(kind, n) when n > 0,
    do: :telemetry.execute([:thirstr, :chat, :expired], %{count: n}, %{kind: kind})

  def expired(_, _), do: :ok

  # ------------------------------------------------------------------ sockets

  def socket_joined(env?, ms) do
    :telemetry.execute([:thirstr, :socket, :join], %{duration_ms: ms}, %{env: env?})
  end

  def socket_closed(reason) do
    r =
      case reason do
        :normal -> "normal"
        :shutdown -> "shutdown"
        {:shutdown, :closed} -> "normal"
        {:shutdown, :left} -> "normal"
        {:shutdown, _} -> "shutdown"
        :timeout -> "timeout"
        _ -> "error"
      end

    :telemetry.execute([:thirstr, :socket, :close], %{count: 1}, %{reason: r})
  end

  # ------------------------------------------------------------------ push wake

  @doc "Provider accepted a push for this device."
  def push_sent(device_id, platform) when is_binary(device_id) do
    now = System.system_time(:millisecond)

    case Valkey.safe(["SET", "pw:" <> device_id, Integer.to_string(now), "EX", "86400", "GET"]) do
      {:ok, old} when is_binary(old) ->
        case Integer.parse(old) do
          {t, _} when now - t > @wake_window_ms -> wake_result(platform, "none")
          _ -> :ok
        end

      _ ->
        :ok
    end
  end

  def push_sent(_, _), do: :ok

  @doc "The device pulled or joined: if a push is pending, record the wake time."
  def device_seen(device_id) when is_binary(device_id) do
    case Valkey.safe(["GETDEL", "pw:" <> device_id]) do
      {:ok, v} when is_binary(v) ->
        platform = platform(device_id)

        with {t, _} <- Integer.parse(v) do
          ms = System.system_time(:millisecond) - t

          if ms <= @wake_window_ms do
            :telemetry.execute([:thirstr, :push, :wake], %{duration_ms: ms}, %{
              platform: platform || "?"
            })

            wake_result(platform, "woke")
          else
            wake_result(platform, "none")
          end
        end

        :ok

      _ ->
        :ok
    end
  end

  def device_seen(_), do: :ok

  defp wake_result(platform, result),
    do:
      :telemetry.execute([:thirstr, :push, :wake_result], %{count: 1}, %{
        platform: platform || "?",
        result: result
      })

  defp platform(device_id) do
    case Repo.query("SELECT push_platform FROM devices WHERE id = $1", [
           Ecto.UUID.dump!(device_id)
         ]) do
      {:ok, %{rows: [[p]]}} -> p
      _ -> nil
    end
  rescue
    _ -> nil
  end

  # ------------------------------------------------------------------ periodic gauges

  @doc "Poller (60 s): stuck envelopes for live devices on this node + live socket count."
  def measure do
    live = local_live()
    :telemetry.execute([:thirstr, :socket], %{live: length(live)}, %{})

    n =
      case live do
        [] ->
          0

        ids ->
          %{rows: [[n]]} =
            Repo.query!(
              "SELECT count(*) FROM mls_messages WHERE to_device_id = ANY($1) AND created_at < now() - interval '2 minutes'",
              [Enum.map(ids, &Ecto.UUID.dump!/1)]
            )

          n
      end

    :telemetry.execute([:thirstr, :chat], %{stuck_online: n}, %{})
  rescue
    _ -> :ok
  end
end
