defmodule Thirstr.Places.OsmImport do
  @moduledoc """
  F-12 R-12.9 (#113): imports public venues from OpenStreetMap (Overpass API) into `venues`.

  Runs on our server only, weekly and from the admin console. Queries never contain anything
  about users: gay venues are fetched worldwide by tag (no area), gyms for a fixed list of
  countries set by the team (`config :thirstr, :places, gym_regions: [...]`).
  Data © OpenStreetMap contributors (ODbL).
  """
  require Logger
  alias Thirstr.Repo

  @gay_kinds ~w(club bar sauna)

  @gay_query """
  [out:json][timeout:900];
  (
    nwr["lgbtq"~"^(primary|only)$"]["amenity"~"^(bar|pub|nightclub|sauna)$"];
    nwr["lgbtq"~"^(primary|only)$"]["leisure"="sauna"];
    nwr["gay"="yes"]["amenity"~"^(bar|pub|nightclub|sauna)$"];
    nwr["gay"="yes"]["leisure"="sauna"];
  );
  out center tags;
  """

  def gym_query(iso) when is_binary(iso) do
    iso = String.replace(iso, ~r/[^A-Z]/, "")

    """
    [out:json][timeout:900];
    area["ISO3166-1"="#{iso}"]["admin_level"="2"]->.a;
    nwr["leisure"="fitness_centre"]["name"](area.a);
    out center tags;
    """
  end

  defp cfg, do: Application.get_env(:thirstr, :places, [])
  def enabled?, do: Keyword.get(cfg(), :osm_import, false)

  @doc "Full import: gay venues worldwide + gyms per configured region. Returns the summary."
  def run(fetch \\ &fetch/1) do
    started = DateTime.utc_now()

    %{rows: [[import_id]]} =
      Repo.query!("INSERT INTO place_imports (started_at) VALUES ($1) RETURNING id", [started])

    {gay, gay_ok} = fetch_all([@gay_query], fetch)
    regions = Keyword.get(cfg(), :gym_regions, [])
    {gyms, gyms_ok} = fetch_all(Enum.map(regions, &gym_query/1), fetch)

    venues = Enum.uniq_by(gay ++ gyms, & &1.ext_id)
    {added, updated} = upsert(venues)

    removed =
      remove_missing(
        if(gay_ok, do: @gay_kinds, else: []) ++ if(gyms_ok, do: ["gym"], else: []),
        venues
      )

    err =
      case {gay_ok, gyms_ok} do
        {true, true} -> nil
        _ -> "some Overpass queries failed; their venues were kept"
      end

    Repo.query!(
      "UPDATE place_imports SET finished_at = now(), added = $2, updated = $3, removed = $4, error = $5 WHERE id = $1",
      [import_id, added, updated, removed, err]
    )

    %{added: added, updated: updated, removed: removed, error: err}
  end

  defp fetch_all(queries, fetch) do
    Enum.reduce(queries, {[], true}, fn q, {acc, ok} ->
      case fetch.(q) do
        {:ok, body} ->
          {acc ++ parse(body), ok}

        {:error, reason} ->
          Logger.warning("osm import query failed: #{inspect(reason)}")
          {acc, false}
      end
    end)
  end

  defp fetch(query) do
    url = Keyword.get(cfg(), :overpass_url, "https://overpass-api.de/api/interpreter")

    case Req.post(url,
           form: [data: query],
           receive_timeout: 900_000,
           retry: :transient,
           headers: [{"user-agent", "thirstr-places-import/1"}]
         ) do
      {:ok, %{status: 200, body: body}} -> {:ok, body}
      {:ok, %{status: s}} -> {:error, {:status, s}}
      {:error, e} -> {:error, e}
    end
  end

  @doc "Overpass JSON → venue maps. Elements without a name or position are skipped."
  def parse(body) when is_binary(body), do: body |> Jason.decode!() |> parse()

  def parse(%{"elements" => els}) do
    Enum.flat_map(els, fn el ->
      tags = el["tags"] || %{}
      {lat, lng} = position(el)
      name = tags["name"] |> to_string() |> String.trim() |> String.slice(0, 120)
      kind = kind(tags)

      if lat && lng && name != "" && kind do
        [
          %{
            ext_id: "osm:#{el["type"]}/#{el["id"]}",
            name: name,
            kind: kind,
            lat: lat * 1.0,
            lng: lng * 1.0,
            hours: tags["opening_hours"] && String.slice(tags["opening_hours"], 0, 255)
          }
        ]
      else
        []
      end
    end)
  end

  def parse(_), do: []

  defp position(%{"lat" => la, "lon" => lo}), do: {la, lo}
  defp position(%{"center" => %{"lat" => la, "lon" => lo}}), do: {la, lo}
  defp position(_), do: {nil, nil}

  defp kind(%{"leisure" => "fitness_centre"}), do: "gym"
  defp kind(%{"amenity" => "nightclub"}), do: "club"
  defp kind(%{"amenity" => a}) when a in ["bar", "pub"], do: "bar"
  defp kind(%{"amenity" => "sauna"}), do: "sauna"
  defp kind(%{"leisure" => "sauna"}), do: "sauna"
  defp kind(_), do: nil

  @doc "Upserts by ext_id; hidden venues keep their flag. Returns {added, updated}."
  def upsert(venues) do
    venues
    |> Enum.chunk_every(500)
    |> Enum.reduce({0, 0}, fn chunk, {a, u} ->
      %{rows: rows} =
        Repo.query!(
          """
          INSERT INTO venues (id, name, kind, lat, lng, hours_text, ext_id, added_by, cell_r9, cell_r5, created_at, updated_at)
          SELECT gen_random_uuid(), x.name, x.kind, x.lat, x.lng, x.hours, x.ext, 'team',
                 h3_lat_lng_to_cell(point(x.lng, x.lat), 9)::bigint,
                 h3_lat_lng_to_cell(point(x.lng, x.lat), 5)::bigint, now(), now()
          FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[], $6::text[])
               AS x(name, kind, lat, lng, hours, ext)
          ON CONFLICT (ext_id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
            lat = EXCLUDED.lat, lng = EXCLUDED.lng, hours_text = EXCLUDED.hours_text,
            cell_r9 = EXCLUDED.cell_r9, cell_r5 = EXCLUDED.cell_r5, updated_at = now()
          RETURNING (xmax = 0)
          """,
          [
            Enum.map(chunk, & &1.name),
            Enum.map(chunk, & &1.kind),
            Enum.map(chunk, & &1.lat),
            Enum.map(chunk, & &1.lng),
            Enum.map(chunk, & &1.hours),
            Enum.map(chunk, & &1.ext_id)
          ]
        )

      new = Enum.count(rows, &(&1 == [true]))
      {a + new, u + length(rows) - new}
    end)
  end

  # OSM venues of these kinds that are gone from the source, unless someone is checked in.
  defp remove_missing([], _), do: 0

  defp remove_missing(kinds, venues) do
    %{num_rows: n} =
      Repo.query!(
        """
        DELETE FROM venues v WHERE v.ext_id LIKE 'osm:%' AND v.kind = ANY($1)
          AND NOT (v.ext_id = ANY($2))
          AND NOT EXISTS (SELECT 1 FROM venue_checkins c WHERE c.venue_id = v.id)
        """,
        [kinds, Enum.map(venues, & &1.ext_id)]
      )

    n
  end
end
