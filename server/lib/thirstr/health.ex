defmodule Thirstr.Health do
  @moduledoc """
  EN-23 OB-6 (#343): data for the console Health page (`/admin/health`, A-12). Reads Fly
  Prometheus with the read-only org token the Costs page already uses (`FLY_COST_TOKEN`), runs
  the queries in parallel and caches the result 60 s per (app, range). Counts and durations
  only: the metrics carry no ids (docs/runbooks/monitoring.md).
  """
  alias Thirstr.Valkey

  @ranges %{"24h" => 86_400, "7d" => 604_800, "28d" => 2_419_200}
  @ttl_ms 60_000
  @groups [
    {"Chat", "/v1/mls.*"},
    {"Explore", "/v1/explore.*"},
    {"Profile", "/v1/(me|profiles).*"},
    {"Auth", "/v1/auth.*"},
    {"Media", "/v1/media.*"},
    {"Other", "other"}
  ]

  def ranges, do: Map.keys(@ranges)
  def init_cache, do: :ets.new(:thirstr_health, [:named_table, :public, read_concurrency: true])

  def configured?, do: token() not in [nil, ""]

  # ------------------------------------------------------------------ probe (last run)

  @doc "Keeps the last probe result (steps and outcome only) for the page, 1 day."
  def put_probe(r) when is_map(r) do
    v = r |> Map.put("at", DateTime.utc_now() |> DateTime.to_iso8601()) |> Jason.encode!()
    Valkey.safe(["SET", "probe:last", v, "EX", "86400"])
    :ok
  end

  def last_probe do
    case Valkey.safe(["GET", "probe:last"]) do
      {:ok, v} when is_binary(v) -> Jason.decode!(v)
      _ -> nil
    end
  rescue
    _ -> nil
  end

  # ------------------------------------------------------------------ snapshot

  @doc "Everything the page shows for `app` over `range` (24h / 7d / 28d)."
  def snapshot(app, range) when is_map_key(@ranges, range) do
    key = {app, range}
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(:thirstr_health, key) do
      [{^key, at, snap}] when now - at < @ttl_ms ->
        snap

      _ ->
        snap = build(app, range)
        :ets.insert(:thirstr_health, {key, now, snap})
        snap
    end
  rescue
    ArgumentError -> build(app, range)
  end

  defp build(app, range) do
    if configured?() do
      queries = queries(app, range)

      vals =
        queries
        |> Task.async_stream(fn {k, q} -> {k, run(q)} end,
          max_concurrency: 8,
          timeout: 20_000,
          on_timeout: :kill_task
        )
        |> Enum.reduce(%{}, fn
          {:ok, {k, v}}, acc -> Map.put(acc, k, v)
          _, acc -> acc
        end)

      errors = Enum.count(vals, fn {_, v} -> v == :error end)

      %{
        ok: errors < map_size(queries),
        partial: errors > 0,
        v: Map.new(vals, fn {k, v} -> {k, if(v == :error, do: nil, else: v)} end),
        range: range,
        at: DateTime.utc_now()
      }
    else
      %{ok: false, partial: false, v: %{}, range: range, at: DateTime.utc_now()}
    end
  end

  # {key (atom, or string for generated ones), {:instant, promql} | {:range, promql}}
  @doc false
  def queries(app, range) do
    a = ~s(app="#{app}")
    w = range
    pct = fn q, m -> ~s|histogram_quantile(#{q}, sum by (le) (rate(#{m}[#{w}])))| end
    inc = fn m -> ~s|sum(increase(#{m}[#{w}]))| end
    step = div(@ranges[range], 48)

    deliv = ~s|thirstr_chat_delivery_duration_ms_bucket{#{a},recipient="online"}|

    base = %{
      online_p95_1h: {:instant, ~s|histogram_quantile(0.95, sum by (le) (rate(#{deliv}[1h])))|},
      online_ok: {:instant, ratio_good(deliv, ~s|le="1000"|, w)},
      probe_ok: {:instant, inc.(~s|thirstr_probe_run_count{#{a},result="ok"}|)},
      probe_all: {:instant, inc.(~s|thirstr_probe_run_count{#{a}}|)},
      skipped: {:instant, inc.(~s|thirstr_chat_skipped_count{#{a}}|)},
      lost: {:instant, inc.(~s|thirstr_chat_expired_count{#{a},kind="app"}|)},
      stuck_max: {:instant, ~s|max_over_time(sum(thirstr_chat_stuck_online{#{a}})[#{w}:5m])|},
      stuck_now: {:instant, ~s|sum(thirstr_chat_stuck_online{#{a}})|},
      api_p95_1h:
        {:instant,
         ~s|histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket{#{a}}[1h])))|},
      api_rpm:
        {:instant, ~s|sum(rate(phoenix_router_dispatch_stop_duration_count{#{a}}[1h])) * 60|},
      live: {:instant, ~s|sum(thirstr_socket_live{#{a}})|},
      wake_p95: {:instant, pct.(0.95, ~s|thirstr_push_wake_duration_ms_bucket{#{a}}|)},
      backlog: {:instant, ~s|max(thirstr_chat_backlog_count{#{a}})|},
      chart_p50: {:range, pct50(deliv, step), step},
      chart_p95: {:range, pct95(deliv, step), step},
      chart_p99: {:range, pct99(deliv, step), step}
    }

    sends =
      for r <- ~w(stored repeat dropped limited rejected),
          into: %{},
          do: {"send_#{r}", {:instant, inc.(~s|thirstr_chat_send_count{#{a},result="#{r}"}|)}}

    push =
      for o <- ~w(ok retry gone skipped),
          into: %{},
          do: {"push_#{o}", {:instant, inc.(~s|thirstr_push_send_count{#{a},outcome="#{o}"}|)}}

    api =
      for {name, re} <- @groups, into: %{} do
        sel =
          if re == "other",
            do: ~s|#{a},route!~"/v1/(mls\|explore\|me\|profiles\|auth\|media).*"|,
            else: ~s|#{a},route=~"#{re}"|

        {"api_#{name}",
         {:instant,
          ~s|histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket{#{sel}}[#{w}])))|}}
      end

    slos =
      for {id, s} <- slos(a), {suffix, win} <- [{"28d", "28d"}, {"1h", "1h"}], into: %{} do
        {"slo_#{id}_#{suffix}", {:instant, s.(win)}}
      end

    base |> Map.merge(sends) |> Map.merge(push) |> Map.merge(api) |> Map.merge(slos)
  end

  defp ratio_good(bucket, le, w) do
    count = String.replace(bucket, "_bucket{", "_count{")

    ~s|sum(increase(#{String.replace(bucket, "}", ",#{le}}")}[#{w}])) / sum(increase(#{count}[#{w}]))|
  end

  defp pct50(m, step), do: ~s|histogram_quantile(0.5, sum by (le) (rate(#{m}[#{step}s])))|
  defp pct95(m, step), do: ~s|histogram_quantile(0.95, sum by (le) (rate(#{m}[#{step}s])))|
  defp pct99(m, step), do: ~s|histogram_quantile(0.99, sum by (le) (rate(#{m}[#{step}s])))|

  @doc "SLO definitions shown on the page: id → fn window → good ratio (0..1)."
  def slo_list do
    [
      {"7", "Messages arrive fast (online)", "99 % ≤ 1 s", 0.99},
      {"8", "Chat works end to end", "99.5 % probe runs", 0.995},
      {"1", "API available", "99.9 %", 0.999},
      {"3", "Chat relay answers fast", "95 % ≤ 500 ms", 0.95},
      {"4", "Map and grid load fast", "95 % ≤ 300 ms", 0.95},
      {"5", "App doesn't crash", "99.5 % sessions", 0.995}
    ]
  end

  defp slos(a) do
    http = "phoenix_router_dispatch_stop_duration"
    deliv = "thirstr_chat_delivery_duration_ms"

    %{
      "7" => fn w ->
        ~s|sum(increase(#{deliv}_bucket{#{a},recipient="online",le="1000"}[#{w}])) / sum(increase(#{deliv}_count{#{a},recipient="online"}[#{w}]))|
      end,
      "8" => fn w ->
        ~s|sum(increase(thirstr_probe_run_count{#{a},result="ok"}[#{w}])) / sum(increase(thirstr_probe_run_count{#{a}}[#{w}]))|
      end,
      "1" => fn w ->
        ~s|1 - (sum(increase(#{http}_count{#{a},status=~"5.."}[#{w}])) or on() vector(0)) / sum(increase(#{http}_count{#{a}}[#{w}]))|
      end,
      "3" => fn w ->
        ~s|sum(increase(#{http}_bucket{#{a},route="/v1/mls/messages",le="500"}[#{w}])) / sum(increase(#{http}_count{#{a},route="/v1/mls/messages"}[#{w}]))|
      end,
      "4" => fn w ->
        ~s|sum(increase(#{http}_bucket{#{a},route=~"/v1/explore/(grid\|map\|tray\|summary)",le="300"}[#{w}])) / sum(increase(#{http}_count{#{a},route=~"/v1/explore/(grid\|map\|tray\|summary)"}[#{w}]))|
      end,
      "5" => fn w ->
        ~s|1 - (sum(increase(thirstr_client_error_count{#{a},fatal="true"}[#{w}])) or on() vector(0)) / sum(increase(thirstr_client_session_count{#{a}}[#{w}]))|
      end
    }
  end

  def groups, do: Enum.map(@groups, &elem(&1, 0))

  # ------------------------------------------------------------------ Prometheus

  defp run({:instant, q}) do
    case prom("/api/v1/query", query: q) do
      {:ok, [%{"value" => [_, v]} | _]} -> num(v)
      {:ok, []} -> nil
      _ -> :error
    end
  end

  defp run({:range, q, step}) do
    now = System.system_time(:second)

    case prom("/api/v1/query_range", query: q, start: now - 48 * step, end: now, step: step) do
      {:ok, [%{"values" => vs} | _]} -> Enum.map(vs, fn [t, v] -> {t, num(v)} end)
      {:ok, []} -> []
      _ -> :error
    end
  end

  defp num(v) do
    case Float.parse(to_string(v)) do
      {f, _} -> if f in [:nan, :inf], do: nil, else: f
      :error -> nil
    end
  end

  defp prom(path, params) do
    base =
      Application.get_env(:thirstr, :fly_prom_url) ||
        "https://api.fly.io/prometheus/#{Application.get_env(:thirstr, :fly_org, "thirstr")}"

    t = token()
    auth = if String.starts_with?(t, "FlyV1 "), do: t, else: "FlyV1 " <> t

    case Req.get(base <> path,
           params: params,
           headers: [{"authorization", auth}],
           retry: false,
           receive_timeout: 15_000
         ) do
      {:ok, %{status: 200, body: %{"status" => "success", "data" => %{"result" => r}}}} ->
        {:ok, r}

      _ ->
        :error
    end
  rescue
    _ -> :error
  end

  defp token, do: Application.get_env(:thirstr, :fly_cost_token)
end
