defmodule Thirstr.Valkey do
  @moduledoc """
  RAM-only store (ADR-0001): challenges, magic links, rate limits, device flags.
  Valkey runs with persistence disabled, so nothing here survives a restart by design.
  """
  @name __MODULE__

  def child_spec(_opts) do
    url = Application.fetch_env!(:thirstr, :valkey_url)
    # Fly 6PN is IPv6-only.
    socket_opts = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []
    opts = [name: @name, sync_connect: false, socket_opts: socket_opts]
    %{id: @name, start: {Redix, :start_link, [url, opts]}}
  end

  def command!(cmd), do: Redix.command!(@name, cmd)
  def command(cmd), do: Redix.command(@name, cmd)

  @doc "Like command/1 but never raises or exits (Valkey down / restarting): {:ok, v} | {:error, r}."
  def safe(cmd) do
    Redix.command(@name, cmd, timeout: 2_000)
  catch
    :exit, reason -> {:error, reason}
  end

  @doc "Store an Elixir term with a TTL in seconds."
  def put_term(key, term, ttl_s) do
    command!(["SET", key, :erlang.term_to_binary(term), "EX", Integer.to_string(ttl_s)])
    :ok
  end

  @doc "Decode a term written by put_term/3. Input is server-written RAM state, decoded with :safe."
  # sobelow_skip ["Misc.BinToTerm"]
  def decode(bin) do
    if is_binary(bin), do: :erlang.binary_to_term(bin, [:safe])
  end

  @doc "Atomically read and delete (single-use secrets)."
  # Input is server-written (own DB / RAM store), decoded with :safe.
  # sobelow_skip ["Misc.BinToTerm"]
  def take_term(key) do
    case command!(["GETDEL", key]) do
      nil -> nil
      bin -> :erlang.binary_to_term(bin, [:safe])
    end
  end

  def exists?(key), do: command!(["EXISTS", key]) == 1

  @doc """
  Fixed-window counter. Returns {:ok, count} or {:error, :rate_limited, retry_after}.
  SR-11: when Valkey is unreachable it falls back to a per-node ETS window (limits become
  per machine for that time) instead of failing the request.
  """
  def hit(key, limit, window_s) do
    {count, ttl} =
      case pipeline([["INCR", key], ["TTL", key]]) do
        {:ok, [count, ttl]} ->
          if ttl < 0, do: safe(["EXPIRE", key, Integer.to_string(window_s)])
          {count, ttl}

        {:error, reason} ->
          :telemetry.execute([:thirstr, :valkey, :fallback], %{count: 1}, %{
            reason: inspect(reason)
          })

          local_hit(key, window_s)
      end

    if count > limit,
      do: {:error, :rate_limited, max(ttl, 1)},
      else: {:ok, count}
  end

  defp pipeline(cmds) do
    Redix.pipeline(@name, cmds, timeout: 2_000)
  catch
    :exit, reason -> {:error, reason}
  end

  @local :thirstr_local_limits

  @doc false
  def init_local, do: :ets.new(@local, [:named_table, :public, write_concurrency: true])

  defp local_hit(key, window_s) do
    now = System.system_time(:second)
    window = div(now, window_s)
    k = {key, window}
    count = :ets.update_counter(@local, k, {2, 1}, {k, 0, now + window_s})

    if :rand.uniform(200) == 1,
      do: :ets.select_delete(@local, [{{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}])

    {count, (window + 1) * window_s - now}
  end
end
