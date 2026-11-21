defmodule Thirstr.Geo.GeoDb do
  @moduledoc """
  Offline IP → city lookup (R-02.2, #26). Data: DB-IP "IP to City Lite" (CC BY 4.0), converted at
  image build time by `mix thirstr.geo.build` into a compact file that is read with `pread`, so
  the lookup costs no RAM and never leaves the machine. The IP is not logged or stored.

  File layout (`TGEO` v1, big-endian):

      "TGEO" 1::8 n4::32 n6::32 ncities::32
      n4 × <<start::32, city::32>>        sorted IPv4 range starts
      n6 × <<start::64, city::32>>        sorted IPv6 range starts (upper 64 bits)
      (ncities + 1) × <<offset::32>>      into the name blob (city 0 = unknown)
      name blob                           "City\\tCC" entries

  Each record covers `[start, next.start)`; gaps are records pointing at city 0.
  """
  @behaviour Thirstr.Geo.IpGeo

  @magic "TGEO"
  @header 17
  @r4 8
  @r6 12

  @impl true
  def city_for_ip(ip) do
    case lookup(path(), ip) do
      {:ok, %{city: city}} -> {:ok, city}
      _ -> :unknown
    end
  end

  @doc "`GEO_DB_PATH`, else the file baked into the release (`priv/geo/city.tgeo`)."
  def path do
    Application.get_env(:thirstr, :geo_db_path) ||
      Path.join(:code.priv_dir(:thirstr), "geo/city.tgeo")
  end

  @doc "Returns `{:ok, %{city: name, country: cc}}` or `:unknown`."
  def lookup(nil, _ip), do: :unknown

  def lookup(path, ip) do
    case :file.open(path, [:read, :raw, :binary]) do
      {:ok, fd} ->
        try do
          do_lookup(fd, normalize(ip))
        after
          :file.close(fd)
        end

      _ ->
        :unknown
    end
  end

  # ::ffff:a.b.c.d is an IPv4 client seen through an IPv6 socket.
  defp normalize({0, 0, 0, 0, 0, 0xFFFF, ab, cd}),
    do: {:v4, Bitwise.bsl(ab, 16) + cd}

  defp normalize({a, b, c, d}),
    do: {:v4, Bitwise.bsl(a, 24) + Bitwise.bsl(b, 16) + Bitwise.bsl(c, 8) + d}

  defp normalize({a, b, c, d, _, _, _, _}),
    do: {:v6, <<a::16, b::16, c::16, d::16>> |> :binary.decode_unsigned()}

  defp normalize(_), do: :invalid

  defp do_lookup(_fd, :invalid), do: :unknown

  defp do_lookup(fd, {family, key}) do
    case :file.pread(fd, 0, @header) do
      {:ok, <<@magic, 1, n4::32, n6::32, nc::32>>} -> find(fd, family, key, n4, n6, nc)
      _ -> :unknown
    end
  end

  defp find(fd, family, key, n4, n6, nc) do
    {base, n, size, bits} =
      if family == :v4, do: {@header, n4, @r4, 32}, else: {@header + n4 * @r4, n6, @r6, 64}

    with i when i >= 0 <- search(fd, base, size, bits, key, 0, n - 1, -1),
         {:ok, <<_::size(bits), city::32>>} <- :file.pread(fd, base + i * size, size),
         true <- city > 0 and city < nc do
      name(fd, @header + n4 * @r4 + n6 * @r6, nc, city)
    else
      _ -> :unknown
    end
  end

  # Index of the last record whose start ≤ key (binary search, ~22 reads for IPv4).
  defp search(_fd, _base, _size, _bits, _key, lo, hi, best) when lo > hi, do: best

  defp search(fd, base, size, bits, key, lo, hi, best) do
    mid = div(lo + hi, 2)

    case :file.pread(fd, base + mid * size, div(bits, 8)) do
      {:ok, <<start::size(bits)>>} when start <= key ->
        search(fd, base, size, bits, key, mid + 1, hi, mid)

      {:ok, _} ->
        search(fd, base, size, bits, key, lo, mid - 1, best)

      _ ->
        -1
    end
  end

  defp name(fd, table, nc, city) do
    blob = table + (nc + 1) * 4

    with {:ok, <<from::32, to::32>>} <- :file.pread(fd, table + city * 4, 8),
         {:ok, bin} <- :file.pread(fd, blob + from, to - from),
         [city_name, cc] <- :binary.split(bin, "\t") do
      {:ok, %{city: city_name, country: cc}}
    else
      _ -> :unknown
    end
  end
end
