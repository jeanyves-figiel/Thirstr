defmodule Thirstr.Seeds do
  @moduledoc """
  Fake data for DEV and staging (testing.md › Test data): 5 000 profiles across the
  three seed cities (D-05) with centre-weighted density. No real people, no photos.
  Idempotent: does nothing if seeded profiles already exist.
  """
  alias Thirstr.Repo

  # name, country, lat, lng, share of seeded profiles
  @seed_cities [
    {"Zurich", "CH", 47.3769, 8.5417, 0.30},
    {"Berlin", "DE", 52.5200, 13.4050, 0.40},
    {"Paris", "FR", 48.8566, 2.3522, 0.30}
  ]

  # City picker (S-04b). Public coordinates of city centres only.
  @picker_cities [
    {"Amsterdam", "NL", 52.3676, 4.9041},
    {"Athens", "GR", 37.9838, 23.7275},
    {"Barcelona", "ES", 41.3874, 2.1686},
    {"Basel", "CH", 47.5596, 7.5886},
    {"Bern", "CH", 46.9480, 7.4474},
    {"Brussels", "BE", 50.8503, 4.3517},
    {"Cologne", "DE", 50.9375, 6.9603},
    {"Copenhagen", "DK", 55.6761, 12.5683},
    {"Dublin", "IE", 53.3498, -6.2603},
    {"Frankfurt", "DE", 50.1109, 8.6821},
    {"Geneva", "CH", 46.2044, 6.1432},
    {"Hamburg", "DE", 53.5511, 9.9937},
    {"Lausanne", "CH", 46.5197, 6.6323},
    {"Lisbon", "PT", 38.7223, -9.1393},
    {"London", "GB", 51.5072, -0.1276},
    {"Lyon", "FR", 45.7640, 4.8357},
    {"Madrid", "ES", 40.4168, -3.7038},
    {"Marseille", "FR", 43.2965, 5.3698},
    {"Milan", "IT", 45.4642, 9.1900},
    {"Munich", "DE", 48.1351, 11.5820},
    {"Prague", "CZ", 50.0755, 14.4378},
    {"Rome", "IT", 41.9028, 12.4964},
    {"Stockholm", "SE", 59.3293, 18.0686},
    {"Vienna", "AT", 48.2082, 16.3738},
    {"Warsaw", "PL", 52.2297, 21.0122}
  ]

  @names ~w(Alex Ben Chris Dan Eli Finn Gabe Hugo Ivan Jonas Kai Leo Max Nico Oli Pablo Quinn Rafa Sam Tom Ugo Vince Will Xavi Yann Zac
            Luca Matteo Jules Theo Noah Luis Marc Felix Emil Anton Milan Rémi Bastien Lukas Jan Paul Karim Omar Malik Ari Tiago Sven Rico Dario)
  @genders [{"man", 88}, {"trans_man", 5}, {"non_binary", 5}, {"other", 2}]
  @here_for ~w(hookup tonight chat friends sport)

  def run(count \\ 5000) do
    seed_cities()
    seed_venues()

    if Repo.query!("SELECT count(*) FROM profiles WHERE seeded").rows == [[0]] do
      :rand.seed(:exsss, {20_261_117, 7443, 5})

      Enum.each(@seed_cities, fn {name, _c, lat, lng, share} ->
        seed_city(name, lat, lng, round(count * share))
      end)
    end

    :ok
  end

  # F-12 DEV venues (testing.md): a few fictional places in Zurich so check-in can be tried.
  @seed_venues [
    {"Dampfbad Kreis 4", "sauna", 47.3769, 8.5417},
    {"Bar Neon", "bar", 47.3745, 8.5300},
    {"Club Lagerhaus", "club", 47.3890, 8.5170},
    {"Iron Gym Letten", "gym", 47.3870, 8.5300},
    {"Altstetten Fitness", "gym", 47.3905, 8.4880},
    {"Bar Altstetten", "bar", 47.3880, 8.4840}
  ]

  defp seed_venues do
    Enum.each(@seed_venues, fn {name, kind, lat, lng} ->
      Repo.query!(
        """
        INSERT INTO venues (id, name, kind, cell_r9, cell_r5, lat, lng, created_at)
        SELECT gen_random_uuid(), $1::text, $2::text,
               h3_lat_lng_to_cell(point($4::float8, $3::float8), 9)::bigint,
               h3_lat_lng_to_cell(point($4::float8, $3::float8), 5)::bigint, $3, $4, now()
        WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = $1)
        """,
        [name, kind, lat, lng]
      )

      Repo.query!("UPDATE venues SET lat = $2, lng = $3 WHERE name = $1 AND lat IS NULL", [
        name,
        lat,
        lng
      ])
    end)

    # R-10.10: one official party at the club, tonight (DEV only).
    Repo.query!("""
    INSERT INTO events (id, venue_id, title, starts_at, ends_at, created_at)
    SELECT gen_random_uuid(), v.id, 'Glitter Night', date_trunc('day', now()) + interval '22 hours',
           date_trunc('day', now()) + interval '30 hours', now()
    FROM venues v WHERE v.name = 'Club Lagerhaus'
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venue_id = v.id AND e.ends_at > now())
    """)
  end

  defp seed_cities do
    all = Enum.map(@seed_cities, fn {n, c, la, lo, _} -> {n, c, la, lo} end) ++ @picker_cities

    Enum.each(all, fn {name, country, lat, lng} ->
      Repo.query!(
        """
        INSERT INTO cities (name, country, lat, lng, cell_r5, search_key, population)
        SELECT $1::text, $2::text, $3::float8, $4::float8, h3_lat_lng_to_cell(point($4::float8, $3::float8), 5)::bigint, $5::text, 100000
        WHERE NOT EXISTS (SELECT 1 FROM cities WHERE name = $1::text OR (search_key = $5::text AND country = $2::text))
        """,
        [name, country, lat, lng, Thirstr.Cities.key(name)]
      )
    end)
  end

  defp seed_city(_city, lat0, lng0, n) do
    now = DateTime.utc_now()

    1..n
    |> Enum.chunk_every(500)
    |> Enum.each(fn chunk ->
      rows = Enum.map(chunk, fn _ -> fake(lat0, lng0, now) end)

      Repo.insert_all("accounts", Enum.map(rows, & &1.account), log: false)
      Repo.insert_all("profiles", Enum.map(rows, & &1.profile), log: false)

      {ids, lats, lngs, levels} =
        rows
        |> Enum.map(fn r -> {r.profile.id, r.lat, r.lng, r.level} end)
        |> unzip4()

      Repo.query!(
        """
        INSERT INTO location_cells (profile_id, level, cell_r9, cell_r8, cell_r7, cell_r5, updated_at)
        SELECT id, lvl,
               CASE WHEN lvl = 'city' THEN NULL ELSE h3_lat_lng_to_cell(point(lng, lat), 9)::bigint END,
               CASE WHEN lvl = 'city' THEN NULL ELSE h3_lat_lng_to_cell(point(lng, lat), 8)::bigint END,
               CASE WHEN lvl = 'city' THEN NULL ELSE h3_lat_lng_to_cell(point(lng, lat), 7)::bigint END,
               h3_lat_lng_to_cell(point(lng, lat), 5)::bigint, now()
        FROM unnest($1::uuid[], $2::float8[], $3::float8[], $4::text[]) AS t(id, lat, lng, lvl)
        """,
        [ids, lats, lngs, levels],
        log: false
      )
    end)
  end

  defp fake(lat0, lng0, now) do
    account_id = Ecto.UUID.bingenerate()
    profile_id = Ecto.UUID.bingenerate()
    # centre-weighted: ~65 % within 3 km, tail to ~12 km
    r_km = abs(:rand.normal() * 3.5) |> min(12.0)
    theta = :rand.uniform() * 2 * :math.pi()
    lat = lat0 + r_km / 111.0 * :math.cos(theta)
    lng = lng0 + r_km / (111.0 * :math.cos(lat0 * :math.pi() / 180)) * :math.sin(theta)
    gender = weighted(@genders)

    here =
      Enum.filter(@here_for, fn h ->
        :rand.uniform() < if(h in ~w(hookup tonight), do: 0.7, else: 0.3)
      end)

    %{
      lat: lat,
      lng: lng,
      level: if(:rand.uniform() < 0.1, do: "city", else: "area"),
      account: %{
        id: account_id,
        status: "active",
        safe_mode: "off",
        onboarding_step: "done",
        verified_at: if(:rand.uniform() < 0.6, do: now),
        verification_epoch: 0,
        # most seeded guys let unverified people browse them (R-17.7 default is on)
        settings: %{"hide_from_unverified" => :rand.uniform() < 0.3},
        inserted_at: now,
        updated_at: now
      },
      profile: %{
        id: profile_id,
        account_id: account_id,
        kind: "now",
        display_name: Enum.random(@names),
        age: (18 + trunc(abs(:rand.normal() * 10) + 7)) |> min(70),
        gender: gender,
        gender_other: if(gender == "other", do: "Genderfluid"),
        here_for: if(here == [], do: ["chat"], else: here),
        show_in: Thirstr.Profiles.Profile.lenses_for(if(here == [], do: ["chat"], else: here)),
        visibility_map: %{},
        fields: fake_fields(),
        photo_ids: [],
        completeness: 40 + :rand.uniform(60),
        seeded: true,
        inserted_at: now,
        updated_at: now
      }
    }
  end

  defp fake_fields do
    opts = Thirstr.Profiles.Fields.options()

    %{
      "build" => Enum.random(opts.build),
      "height_cm" => 165 + :rand.uniform(30),
      "position" => Enum.random(opts.position),
      "hosting" => Enum.random(opts.hosting),
      "looking_for" => Enum.take_random(opts.looking_for, 2),
      "tribes" => Enum.take_random(opts.tribes, 1),
      "languages" => Enum.take_random(~w(en fr de it es), 2),
      "bio" =>
        Enum.random([
          "Here for a good time.",
          "Coffee first?",
          "New in town.",
          "Gym, food, repeat.",
          ""
        ])
    }
    |> Map.reject(fn {_, v} -> v == "" end)
  end

  defp weighted(pairs) do
    total = pairs |> Enum.map(&elem(&1, 1)) |> Enum.sum()
    pick = :rand.uniform(total)

    Enum.reduce_while(pairs, 0, fn {v, w}, acc ->
      if pick <= acc + w, do: {:halt, v}, else: {:cont, acc + w}
    end)
  end

  defp unzip4(list) do
    Enum.reduce(Enum.reverse(list), {[], [], [], []}, fn {a, b, c, d}, {as, bs, cs, ds} ->
      {[a | as], [b | bs], [c | cs], [d | ds]}
    end)
  end
end
