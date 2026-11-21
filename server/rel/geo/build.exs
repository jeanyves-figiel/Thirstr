# Image build step (server/Dockerfile, stage `geo`, #26): downloads DB-IP "IP to City Lite"
# (CC BY 4.0, monthly) and writes the compact TGEO file. Runs without the app or deps:
#   elixir -r lib/thirstr/geo/geo_db_builder.ex rel/geo/build.exs OUT [YYYY-MM]
# A failed download never fails the image: the Welcome city is then simply unknown.
[out | rest] = System.argv()
today = Date.utc_today()
month = List.first(rest) || Calendar.strftime(today, "%Y-%m")
prev = today |> Date.beginning_of_month() |> Date.add(-1) |> Calendar.strftime("%Y-%m")

:ok = Application.ensure_all_started(:inets) |> elem(0)
{:ok, _} = Application.ensure_all_started(:ssl)
tmp = "/tmp/dbip.csv.gz"

ssl = [
  verify: :verify_peer,
  cacerts: :public_key.cacerts_get(),
  customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]
]

fetch = fn m ->
  url = ~c"https://download.db-ip.com/free/dbip-city-lite-#{m}.csv.gz"
  opts = [ssl: ssl, timeout: 600_000]

  case :httpc.request(:get, {url, []}, opts, stream: String.to_charlist(tmp)) do
    {:ok, :saved_to_file} ->
      true

    other ->
      IO.puts(:stderr, "geo: #{m} download failed: #{inspect(other)}")
      false
  end
end

if Enum.any?(Enum.uniq([month, prev]), fetch) do
  counts =
    tmp
    |> File.stream!([:compressed], :line)
    |> Stream.map(&Thirstr.Geo.GeoDbBuilder.parse_line/1)
    |> Thirstr.Geo.GeoDbBuilder.build(out)

  File.rm(tmp)
  IO.puts("geo: #{inspect(counts)} → #{out} (#{File.stat!(out).size} bytes)")
else
  IO.puts(:stderr, "geo: WARNING no DB-IP file; Welcome city will be unknown")
end
