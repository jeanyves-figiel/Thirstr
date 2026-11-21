defmodule ThirstrWeb.TestHelpers do
  @moduledoc false
  import Plug.Conn
  import Phoenix.ConnTest
  @endpoint ThirstrWeb.Endpoint

  @doc "Signs up through the dev OIDC issuer; returns {authed_conn, session_json}."
  def sign_up(conn, sub \\ nil) do
    token = Thirstr.Auth.OIDC.dev_mint(sub || "sub-" <> Thirstr.Ids.random_token(6))

    body =
      conn
      |> post("/v1/auth/oidc", %{provider: "apple", id_token: token, age_confirmed: true})
      |> json_response(201)

    {authed(conn, body["access_token"]), body}
  end

  def authed(conn, access),
    do:
      conn
      |> recycle()
      |> put_req_header("authorization", "Bearer " <> access)
      |> put_req_header("x-thirstr-install", "test-install-0123456789")

  @doc "Keeps the bearer + install headers across requests."
  def recycle_authed(conn) do
    [auth] = get_req_header(conn, "authorization")

    conn
    |> recycle()
    |> put_req_header("authorization", auth)
    |> put_req_header("x-thirstr-install", "test-install-0123456789")
  end

  def adult_birthdate, do: Date.utc_today() |> Date.add(-25 * 366) |> Date.to_iso8601()

  def basics(conn, attrs \\ %{}) do
    put(
      conn,
      "/v1/me/basics",
      Map.merge(
        %{
          display_name: "Max",
          birthdate: adult_birthdate(),
          gender: "man",
          here_for: ["hookup", "tonight"]
        },
        attrs
      )
    )
  end

  @doc "Zurich centre at r9, computed by Postgres h3."
  def zurich_r9 do
    %{rows: [[c]]} =
      Thirstr.Repo.query!("SELECT h3_lat_lng_to_cell(point(8.5417, 47.3769), 9)::text")

    c
  end

  @doc "A fully onboarded user at a Zurich r9 cell with an accepted main photo. Returns %{c, me, pid}."
  def onboarded(conn, opts \\ []) do
    {c, _} = sign_up(conn)
    c |> basics(Map.new(Keyword.get(opts, :basics, []))) |> json_response(200)
    cell = Keyword.get(opts, :cell, zurich_r9())

    me =
      c
      |> recycle_authed()
      |> put("/v1/me/location", %{level: "area", cell_r9: cell})
      |> json_response(200)

    pid = me["profile"]["id"]

    up =
      c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{pid}/photos", %{slot: 0})
      |> json_response(201)

    c
    |> recycle_authed()
    |> post("/v1/me/profiles/#{pid}/photos/#{up["photo_id"]}/check")
    |> json_response(200)

    me = c |> recycle_authed() |> post("/v1/me/onboarding/verify_later") |> json_response(200)

    if Keyword.get(opts, :verified, true), do: verify!(pid)
    %{c: recycle_authed(c), me: me, pid: pid}
  end

  def verify!(profile_id) do
    Thirstr.Repo.query!(
      "UPDATE accounts SET verified_at = now(), settings = settings || '{\"hide_from_unverified\": false}' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [Ecto.UUID.dump!(profile_id)]
    )
  end

  def account_of(profile_id) do
    %{rows: [[id]]} =
      Thirstr.Repo.query!("SELECT account_id::text FROM profiles WHERE id = $1", [
        Ecto.UUID.dump!(profile_id)
      ])

    Thirstr.Repo.get!(Thirstr.Accounts.Account, id)
  end

  @doc "Neighbour r9 cell k steps away from Zurich centre."
  def zurich_ring(k) do
    %{rows: [[c]]} =
      Thirstr.Repo.query!(
        "SELECT c::text FROM h3_grid_ring_unsafe(h3_lat_lng_to_cell(point(8.5417, 47.3769), 9), $1::int) c LIMIT 1",
        [k]
      )

    c
  end

  def ids(items), do: Enum.map(items, & &1["id"])
end
