defmodule Thirstr.Cities do
  @moduledoc """
  Public city catalogue (`cities`): S-04b picker, Welcome, live header place names and F-20 trip
  cities. Loaded from `priv/cities/cities.tsv` (GeoNames, CC BY 4.0). Public data only.
  """

  @doc "Search key: lowercase, accents removed (\"Zürich\" → \"zurich\")."
  def key(name) when is_binary(name) do
    name
    |> String.normalize(:nfd)
    |> String.replace(~r/\p{Mn}/u, "")
    |> String.downcase()
    |> String.replace("ß", "ss")
    |> String.trim()
  end

  @doc """
  Loads the bundled catalogue into `cities` (idempotent). Rows that already exist with the same
  search key and country are kept (their ids may be referenced); missing keys are filled in.
  """
  # The path is the bundled priv file, never user input.
  # sobelow_skip ["Traversal.FileModule"]
  def load!(repo) do
    path = Application.app_dir(:thirstr, "priv/cities/cities.tsv")

    existing =
      repo.query!("SELECT id, name, country FROM cities").rows

    Enum.each(existing, fn [id, name, _] ->
      repo.query!("UPDATE cities SET search_key = $2 WHERE id = $1", [id, key(name)])
    end)

    have = MapSet.new(existing, fn [_, name, cc] -> {key(name), cc} end)

    path
    |> File.stream!()
    |> Stream.reject(&String.starts_with?(&1, "#"))
    |> Stream.map(&(&1 |> String.trim_trailing("\n") |> String.split("\t")))
    |> Stream.filter(&(length(&1) == 6))
    |> Stream.map(fn [name, _k, cc, lat, lng, pop] ->
      {name, key(name), cc, String.to_float(lat), String.to_float(lng), String.to_integer(pop)}
    end)
    |> Stream.reject(fn {_, k, cc, _, _, _} -> MapSet.member?(have, {k, cc}) end)
    |> Stream.uniq_by(fn {_, k, cc, _, _, _} -> {k, cc} end)
    |> Stream.chunk_every(2_000)
    |> Enum.each(fn chunk ->
      cols = chunk |> Enum.map(&Tuple.to_list/1) |> Enum.zip_with(& &1)

      repo.query!(
        """
        INSERT INTO cities (name, search_key, country, lat, lng, population, cell_r5)
        SELECT n, k, c, la, lo, p, h3_lat_lng_to_cell(point(lo, la), 5)::bigint
        FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::int[])
          AS t(n, k, c, la, lo, p)
        """,
        cols
      )
    end)

    # Known cities keep their ids; give them a population so search ranks them.
    repo.query!("""
    UPDATE cities SET population = 100000 WHERE population = 0
    """)

    :ok
  end
end
