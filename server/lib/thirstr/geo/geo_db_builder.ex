defmodule Thirstr.Geo.GeoDbBuilder do
  @moduledoc """
  Builds the `TGEO` file read by `Thirstr.Geo.GeoDb` from a DB-IP "IP to City Lite" CSV
  (`ip_start,ip_end,continent,country,stateprov,city,latitude,longitude`, sorted by start,
  IPv4 then IPv6). Adjacent ranges of the same city are merged and IPv6 is cut to /64, which
  keeps the file small (city precision is all the Welcome screen needs).
  """
  import Bitwise

  @doc "Streams `rows` (lists of CSV fields) into `out`. Returns counts."
  # Build-time only (image build / mix task); `out` comes from the operator, never a request.
  # sobelow_skip ["Traversal.FileModule"]
  def build(rows, out) do
    init = %{cities: %{}, n: 1, v4: new_family(), v6: new_family()}

    st =
      Enum.reduce(rows, init, fn row, st ->
        with [s, e, _cont, cc, _region, city | _] <- row,
             {:ok, s} <- :inet.parse_address(String.to_charlist(s)),
             {:ok, e} <- :inet.parse_address(String.to_charlist(e)) do
          {st, idx} = city_idx(st, city, cc)

          case {to_int(s), to_int(e)} do
            {{:v4, a}, {:v4, b}} -> %{st | v4: add(st.v4, a, b, idx)}
            {{:v6, a}, {:v6, b}} -> %{st | v6: add(st.v6, a >>> 64, b >>> 64, idx)}
            _ -> st
          end
        else
          _ -> st
        end
      end)

    v4 = finish(st.v4, 0xFFFFFFFF)
    v6 = finish(st.v6, 0xFFFFFFFFFFFFFFFF)
    names = st.cities |> Enum.sort_by(&elem(&1, 1)) |> Enum.map(&elem(&1, 0))
    names = ["\t" | names]

    {offsets, _} =
      Enum.map_reduce(names, 0, fn n, off -> {<<off::32>>, off + byte_size(n)} end)

    total = Enum.reduce(names, 0, &(byte_size(&1) + &2))

    File.write!(out, [
      "TGEO",
      1,
      <<length(v4)::32, length(v6)::32, length(names)::32>>,
      Enum.map(v4, fn {s, c} -> <<s::32, c::32>> end),
      Enum.map(v6, fn {s, c} -> <<s::64, c::32>> end),
      offsets,
      <<total::32>>,
      names
    ])

    %{v4: length(v4), v6: length(v6), cities: length(names) - 1}
  end

  @doc "Minimal CSV line parser (DB-IP quotes fields only when needed)."
  def parse_line(line), do: line |> String.trim_trailing() |> fields([])

  defp fields("", acc), do: Enum.reverse(["" | acc])
  defp fields("\"" <> rest, acc), do: quoted(rest, "", acc)

  defp fields(s, acc) do
    case :binary.split(s, ",") do
      [f, rest] -> fields(rest, [f | acc])
      [f] -> Enum.reverse([f | acc])
    end
  end

  defp quoted("\"\"" <> rest, buf, acc), do: quoted(rest, buf <> "\"", acc)
  defp quoted("\"," <> rest, buf, acc), do: fields(rest, [buf | acc])
  defp quoted("\"", buf, acc), do: Enum.reverse([buf | acc])

  defp quoted(<<c::utf8, rest::binary>>, buf, acc),
    do: quoted(rest, <<buf::binary, c::utf8>>, acc)

  defp quoted("", buf, acc), do: Enum.reverse([buf | acc])

  defp city_idx(st, city, cc) do
    city = city |> String.replace(["\t", "\n"], " ") |> String.trim()
    key = city <> "\t" <> cc

    case st.cities do
      _ when city == "" -> {st, 0}
      %{^key => idx} -> {st, idx}
      _ -> {%{st | cities: Map.put(st.cities, key, st.n), n: st.n + 1}, st.n}
    end
  end

  defp to_int({a, b, c, d}), do: {:v4, (a <<< 24) + (b <<< 16) + (c <<< 8) + d}

  defp to_int({a, b, c, d, e, f, g, h}),
    do: {:v6, :binary.decode_unsigned(<<a::16, b::16, c::16, d::16, e::16, f::16, g::16, h::16>>)}

  # Records are kept reversed: [{start, city}, ...]; `last_end` is the last covered address.
  defp new_family, do: %{recs: [{0, 0}], last_end: -1}

  defp add(%{recs: [{_, lc} | _] = recs, last_end: le} = f, s, e, idx) do
    cond do
      # Overlapping or same /64 as the previous range: keep the earlier city.
      s <= le -> %{f | last_end: max(le, e)}
      # Contiguous and same city: extend.
      s == le + 1 and idx == lc -> %{f | last_end: e}
      # Gap: unknown until s.
      s > le + 1 -> %{f | recs: push(push(recs, le + 1, 0), s, idx), last_end: e}
      true -> %{f | recs: push(recs, s, idx), last_end: e}
    end
  end

  defp push([{s, _} | rest], s, idx), do: [{s, idx} | rest]
  defp push([{_, c} | _] = recs, _s, c), do: recs
  defp push(recs, s, idx), do: [{s, idx} | recs]

  # Trailing gap: addresses after the last range are unknown.
  defp finish(%{recs: recs, last_end: le}, max) when le < max,
    do: recs |> push(le + 1, 0) |> Enum.reverse()

  defp finish(%{recs: recs}, _max), do: Enum.reverse(recs)
end
