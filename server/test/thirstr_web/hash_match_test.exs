defmodule ThirstrWeb.HashMatchTest do
  use ThirstrWeb.ConnCase, async: false

  # F-15 R-15.40–46 (#179, #285): known-CSAM hash match before a public image is published.
  alias Thirstr.Moderation.HashMatch
  alias Thirstr.Repo

  setup %{conn: conn} do
    u = onboarded(conn, basics: [display_name: "Marco"])
    on_exit(fn -> Application.put_env(:thirstr, :hash_match, HashMatch.Dev) end)
    {:ok, u: u}
  end

  defp upload(u, slot, suffix) do
    up =
      u.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{u.pid}/photos", %{slot: slot})
      |> json_response(201)

    Repo.query!("UPDATE photos SET storage_key = storage_key || $2 WHERE id = $1", [
      Ecto.UUID.dump!(up["photo_id"]),
      suffix
    ])

    res =
      u.c
      |> recycle_authed()
      |> post("/v1/me/profiles/#{u.pid}/photos/#{up["photo_id"]}/check")
      |> json_response(200)

    {up["photo_id"], res["photo"]}
  end

  defp photo_row(id) do
    [row] =
      Repo.query!(
        "SELECT status, review_state, hash_state, thumb_key FROM photos WHERE id = $1",
        [Ecto.UUID.dump!(id)]
      ).rows

    row
  end

  defp account_status(u),
    do:
      Repo.query!(
        "SELECT a.status FROM accounts a JOIN profiles p ON p.account_id = a.id WHERE p.id = $1",
        [Ecto.UUID.dump!(u.pid)]
      ).rows

  defp open_cases,
    do: Repo.query!("SELECT count(*) FROM csam_cases WHERE state = 'open'").rows

  @tag ac: "AC-15.12"
  test "a hash hit never publishes, quarantines and opens one case", %{u: u} do
    {id, photo} = upload(u, 1, "-hashhit")
    assert photo["status"] == "rejected"
    assert photo["reject_reason"] == "unusable"
    assert ["rejected", "hash_hit", "match", nil] = photo_row(id)
    assert account_status(u) == [["quarantined"]]
    assert open_cases() == [[1]]

    prof = u.c |> recycle_authed() |> get("/v1/profiles/#{u.pid}") |> json_response(200)
    # Only the main photo from onboarding is public.
    assert length(prof["photos"]) == 1
  end

  @tag ac: "AC-15.13"
  test "a provider error keeps the photo pending and hidden", %{u: u} do
    {id, photo} = upload(u, 1, "-hasherror")
    assert photo["status"] == "pending"
    assert ["pending", nil, "retry", nil] = photo_row(id)
    assert open_cases() == [[0]]

    # Still failing on the retry job: stays hidden.
    Thirstr.Profiles.retry_hash_checks()
    assert ["pending", nil, "retry", nil] = photo_row(id)

    # After 30 min a person decides (A-03).
    Repo.query!("UPDATE photos SET inserted_at = now() - interval '31 minutes' WHERE id = $1", [
      Ecto.UUID.dump!(id)
    ])

    Thirstr.Profiles.retry_hash_checks()
    assert ["pending", "queued", "retry", nil] = photo_row(id)
  end

  @tag ac: "AC-15.14"
  test "noop publishes as unchecked", %{u: u} do
    Application.put_env(:thirstr, :hash_match, HashMatch.Noop)
    {id, photo} = upload(u, 1, "")
    assert photo["status"] == "ok_public"
    assert ["ok_public", nil, "unchecked", _] = photo_row(id)
  end

  @tag ac: "AC-15.15"
  test "an exact re-upload of a blocklisted image is caught without the provider", %{u: u} do
    {id, _} = upload(u, 1, "-x")

    [[key]] =
      Repo.query!("SELECT storage_key FROM photos WHERE id = $1", [Ecto.UUID.dump!(id)]).rows

    {:ok, bytes} = Thirstr.Storage.get(key)
    Repo.query!("INSERT INTO hash_blocklist (sha256) VALUES ($1)", [:crypto.hash(:sha256, bytes)])

    # Noop would never match: only the blocklist can.
    Application.put_env(:thirstr, :hash_match, HashMatch.Noop)
    assert {:match, %{"provider" => "internal"}} = HashMatch.check(key)
  end

  test "the kill switch skips the provider and marks unchecked", %{u: u} do
    Thirstr.Flags.set("hash_match", false, %{}, "test outage")
    {id, photo} = upload(u, 2, "-hashhit")
    assert photo["status"] == "ok_public"
    assert ["ok_public", nil, "unchecked", _] = photo_row(id)
  after
    Thirstr.Flags.delete("hash_match")
  end

  test "a Moment that matches is refused like any rejection and opens a case", %{u: u} do
    up = u.c |> recycle_authed() |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
    mid = json_response(up, 201)["moment_id"]

    Repo.query!("UPDATE moments SET storage_key = storage_key || '-hashhit' WHERE id = $1", [
      Ecto.UUID.dump!(mid)
    ])

    res =
      u.c
      |> recycle_authed()
      |> post("/v1/moments/#{mid}/publish", %{ttl_s: 86_400})
      |> json_response(200)

    assert res["status"] == "rejected"
    assert res["reject_reason"] == "unusable"
    assert open_cases() == [[1]]
    assert account_status(u) == [["quarantined"]]
  end

  test "a Moment is not shared while the provider fails", %{u: u} do
    up = u.c |> recycle_authed() |> post("/v1/moments/uploads", %{content_type: "image/jpeg"})
    mid = json_response(up, 201)["moment_id"]

    Repo.query!("UPDATE moments SET storage_key = storage_key || '-hasherror' WHERE id = $1", [
      Ecto.UUID.dump!(mid)
    ])

    res = u.c |> recycle_authed() |> post("/v1/moments/#{mid}/publish", %{ttl_s: 86_400})
    assert json_response(res, 409)["error"]["code"] == "unavailable"

    [[status]] =
      Repo.query!("SELECT status FROM moments WHERE id = $1", [Ecto.UUID.dump!(mid)]).rows

    assert status == "uploading"
  end
end
