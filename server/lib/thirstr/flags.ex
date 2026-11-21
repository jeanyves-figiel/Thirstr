defmodule Thirstr.Flags do
  @moduledoc """
  EN-13 (#172) server-driven feature flags and kill switches; EN-14 (#173) minimum app build.

  A flag without a row is on (its default below), so a kill switch is one row with
  `enabled = false`. Rules narrow an enabled flag: `platforms` (["ios", "android", "web"]),
  `min_build` (per platform), `percent` (0–100, stable per install). No third-party service,
  no tracking: evaluation uses only what the request already carries.

      bin/thirstr rpc 'Thirstr.Flags.set("video_check", false, %{}, "kill: crash in 1.2")'
      bin/thirstr rpc 'Thirstr.Flags.set("min_build", true, %{"ios" => 140})'
  """
  alias Thirstr.Repo

  # Known flags the app reads (all on by default). Add a name here before shipping code that reads it.
  @defaults %{
    "video_check" => true,
    "chat_media" => true,
    "travel" => true,
    "parties" => true,
    "translate" => true,
    "web_push" => true
  }
  @table :thirstr_flags
  @ttl_ms 30_000

  def defaults, do: @defaults

  def init_cache do
    if :ets.whereis(@table) == :undefined,
      do: :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])

    :ok
  end

  @doc "Request context: platform, native build number, install id (all optional)."
  def ctx(platform, build, install),
    do: %{platform: platform, build: parse_build(build), install: install}

  def parse_build(b) when is_integer(b), do: b

  def parse_build(b) when is_binary(b) do
    case Integer.parse(b) do
      {n, ""} when n >= 0 -> n
      _ -> nil
    end
  end

  def parse_build(_), do: nil

  @doc "Is `name` on for this client? Unknown names are off."
  def enabled?(name, ctx \\ %{}) do
    case Map.fetch(rows(), name) do
      {:ok, %{enabled: false}} -> false
      {:ok, %{rules: r}} -> rules_ok?(name, r, ctx)
      :error -> Map.get(@defaults, name, false)
    end
  end

  @doc "Lowest native build allowed to call the API for a platform (0 = any)."
  def min_build(platform) do
    case rows()["min_build"] do
      %{enabled: true, rules: r} -> to_int(r[to_string(platform)])
      _ -> 0
    end
  end

  def too_old?(%{platform: p, build: b}) when is_integer(b) and p in ["ios", "android"],
    do: b < min_build(p)

  def too_old?(_), do: false

  @doc "GET /v1/config body: same for every client of one platform/build/install bucket."
  def client_config(ctx) do
    names = Map.keys(@defaults) ++ (Map.keys(rows()) -- ["min_build"])

    %{
      min_build: %{ios: min_build("ios"), android: min_build("android")},
      upgrade_required: too_old?(ctx),
      store_url: %{
        ios: System.get_env("IOS_STORE_URL", "https://apps.apple.com/app/thirstr"),
        android:
          System.get_env(
            "ANDROID_STORE_URL",
            "https://play.google.com/store/apps/details?id=app.thirstr"
          )
      },
      flags: names |> Enum.uniq() |> Map.new(&{&1, enabled?(&1, ctx)})
    }
  end

  @doc "Creates or changes a flag (ops, via rpc). Takes effect on every node within 30 s."
  def set(name, enabled, rules \\ %{}, note \\ nil)
      when is_binary(name) and is_boolean(enabled) do
    Repo.query!(
      """
      INSERT INTO feature_flags (name, enabled, rules, note, updated_at) VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (name) DO UPDATE SET enabled = $2, rules = $3, note = $4, updated_at = now()
      """,
      [name, enabled, rules, note]
    )

    :ets.delete(@table, :rows)
    :ok
  end

  def delete(name) do
    Repo.query!("DELETE FROM feature_flags WHERE name = $1", [name])
    :ets.delete(@table, :rows)
    :ok
  end

  defp rows do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, :rows) do
      [{:rows, at, rows}] when now - at < @ttl_ms ->
        rows

      _ ->
        rows =
          Repo.query!("SELECT name, enabled, rules FROM feature_flags").rows
          |> Map.new(fn [n, e, r] -> {n, %{enabled: e, rules: r || %{}}} end)

        :ets.insert(@table, {:rows, now, rows})
        rows
    end
  end

  defp rules_ok?(name, r, ctx) do
    platform_ok?(r["platforms"], ctx[:platform]) and build_ok?(r["min_build"], ctx) and
      percent_ok?(r["percent"], name, ctx[:install])
  end

  defp platform_ok?(nil, _), do: true
  defp platform_ok?(list, p) when is_list(list), do: p in list

  defp build_ok?(%{} = m, %{platform: p, build: b}) when is_integer(b),
    do: b >= to_int(m[to_string(p)])

  defp build_ok?(%{}, _), do: false
  defp build_ok?(_, _), do: true

  defp percent_ok?(nil, _, _), do: true
  defp percent_ok?(pct, _, nil) when is_integer(pct), do: pct >= 100

  defp percent_ok?(pct, name, install) when is_integer(pct),
    do: :erlang.phash2({name, install}, 100) < pct

  defp percent_ok?(_, _, _), do: true

  defp to_int(n) when is_integer(n), do: n
  defp to_int(_), do: 0
end
