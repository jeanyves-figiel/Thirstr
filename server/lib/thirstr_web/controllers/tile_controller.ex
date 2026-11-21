defmodule ThirstrWeb.TileController do
  @moduledoc """
  Map tiles, glyphs and style through our own API (I-03, beta-build-plan.md): the upstream
  tile host only ever sees this server, never a user's IP or viewport. No auth, no user id
  forwarded, long client cache. Upstream: OpenMapTiles-schema vector tiles (`TILES_UPSTREAM`).
  """
  use ThirstrWeb, :controller

  @day 86_400

  def style(conn, _) do
    base = Application.get_env(:thirstr, :app_url) <> "/v1/tiles"

    conn
    |> put_resp_header("cache-control", "public, max-age=#{@day}")
    |> json(ThirstrWeb.MapStyle.pop(base))
  end

  def tile(conn, %{"z" => z, "x" => x, "y" => y}) do
    with {z, ""} <- Integer.parse(z),
         {x, ""} <- Integer.parse(x),
         {y, ""} <- y |> String.replace_suffix(".pbf", "") |> Integer.parse(),
         true <- z in 0..14 and x >= 0 and y >= 0 and x < 2 ** z and y < 2 ** z,
         {:ok, template} <- tile_template() do
      url =
        template
        |> String.replace("{z}", Integer.to_string(z))
        |> String.replace("{x}", Integer.to_string(x))
        |> String.replace("{y}", Integer.to_string(y))

      proxy(conn, url, "application/x-protobuf", 7 * @day)
    else
      _ -> send_resp(conn, 404, "")
    end
  end

  def font(conn, %{"stack" => stack, "range" => range}) do
    if Regex.match?(~r/^[A-Za-z ,]+$/, stack) and Regex.match?(~r/^\d+-\d+(\.pbf)?$/, range) do
      range = String.replace_suffix(range, ".pbf", "")
      url = "#{upstream()}/fonts/#{URI.encode(stack)}/#{range}.pbf"
      proxy(conn, url, "application/x-protobuf", 30 * @day)
    else
      send_resp(conn, 404, "")
    end
  end

  # Binary protobuf from a fixed upstream, served as application/x-protobuf (not HTML).
  # sobelow_skip ["XSS.SendResp", "XSS.ContentType"]
  defp proxy(conn, url, type, max_age) do
    case Req.get(url,
           retry: :transient,
           receive_timeout: 10_000,
           decode_body: false,
           compressed: false
         ) do
      {:ok, %{status: 200, body: body} = res} ->
        enc = Req.Response.get_header(res, "content-encoding")

        conn
        |> then(&if enc != [], do: put_resp_header(&1, "content-encoding", hd(enc)), else: &1)
        |> put_resp_content_type(type, nil)
        |> put_resp_header("cache-control", "public, max-age=#{max_age}")
        |> send_resp(200, body)

      {:ok, %{status: s}} when s in [204, 404] ->
        send_resp(conn, 204, "")

      _ ->
        send_resp(conn, 502, "")
    end
  end

  # OpenFreeMap publishes versioned tile URLs in its TileJSON; refreshed daily.
  defp tile_template do
    case :persistent_term.get({__MODULE__, :tpl}, nil) do
      {tpl, at} when is_binary(tpl) ->
        if System.system_time(:second) - at < @day, do: {:ok, tpl}, else: fetch_template()

      _ ->
        fetch_template()
    end
  end

  defp fetch_template do
    case Req.get("#{upstream()}/planet", retry: :transient, receive_timeout: 10_000) do
      {:ok, %{status: 200, body: %{"tiles" => [tpl | _]}}} ->
        :persistent_term.put({__MODULE__, :tpl}, {tpl, System.system_time(:second)})
        {:ok, tpl}

      _ ->
        :error
    end
  end

  defp upstream,
    do: Application.get_env(:thirstr, :tiles_upstream, "https://tiles.openfreemap.org")
end

defmodule ThirstrWeb.MapStyle do
  @moduledoc "Pop dark map style (design-system.md, Pop). OpenMapTiles schema."

  @c %{
    bg: "#1B1836",
    water: "#1F3A5C",
    park: "#1E2440",
    minor: "#221E40",
    major: "#282449",
    motorway: "#2E2A55",
    building: "#211D3D",
    label: "#C2BDE3",
    halo: "#17142E"
  }

  def pop(base) do
    %{
      version: 8,
      name: "Thirstr Pop",
      glyphs: base <> "/fonts/{fontstack}/{range}",
      sources: %{
        omt: %{type: "vector", tiles: [base <> "/v/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14}
      },
      layers: [
        %{id: "bg", type: "background", paint: %{"background-color" => @c.bg}},
        fill("water", "water", @c.water),
        fill("park", "park", @c.park),
        %{
          id: "landcover",
          type: "fill",
          source: "omt",
          "source-layer": "landcover",
          filter: ["in", "class", "grass", "wood"],
          paint: %{"fill-color" => @c.park, "fill-opacity" => 0.6}
        },
        %{
          id: "building",
          type: "fill",
          source: "omt",
          "source-layer": "building",
          minzoom: 14,
          paint: %{"fill-color" => @c.building}
        },
        road("road-minor", ["in", "class", "minor", "service", "track", "path"], @c.minor, 4),
        road(
          "road-major",
          ["in", "class", "primary", "secondary", "tertiary", "trunk"],
          @c.major,
          8
        ),
        road("road-motorway", ["==", "class", "motorway"], @c.motorway, 10),
        %{
          id: "road-label",
          type: "symbol",
          source: "omt",
          "source-layer": "transportation_name",
          minzoom: 14,
          layout: %{
            "symbol-placement" => "line",
            "text-field" => "{name}",
            "text-font" => ["Noto Sans Regular"],
            "text-size" => 11
          },
          paint: %{
            "text-color" => @c.label,
            "text-halo-color" => @c.halo,
            "text-halo-width" => 1.2
          }
        },
        %{
          id: "place-label",
          type: "symbol",
          source: "omt",
          "source-layer": "place",
          filter: ["in", "class", "city", "town", "suburb", "neighbourhood", "quarter"],
          layout: %{
            "text-field" => "{name}",
            "text-font" => ["Noto Sans Bold"],
            "text-size" => ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 14]
          },
          paint: %{
            "text-color" => @c.label,
            "text-halo-color" => @c.halo,
            "text-halo-width" => 1.5
          }
        }
      ]
    }
  end

  defp fill(id, layer, color),
    do: %{
      id: id,
      type: "fill",
      source: "omt",
      "source-layer": layer,
      paint: %{"fill-color" => color}
    }

  defp road(id, filter, color, width),
    do: %{
      id: id,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: filter,
      layout: %{"line-cap" => "round", "line-join" => "round"},
      paint: %{
        "line-color" => color,
        "line-width" => [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          10,
          width / 4,
          16,
          width * 2
        ]
      }
    }
end
