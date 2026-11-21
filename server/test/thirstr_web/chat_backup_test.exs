defmodule ThirstrWeb.ChatBackupTest do
  use ThirstrWeb.ConnCase, async: false

  # F-01 R-01.15 (#146): opt-in chat backup, ciphertext segments + sealed manifest.
  # The test storage adapter reports every object as 1234 bytes.
  setup %{conn: conn} do
    {pub, _} = :crypto.generate_key(:eddsa, :ed25519)
    {:ok, u: onboarded(conn), pub: pub}
  end

  defp authed(u), do: recycle_authed(u.c)

  defp on(u, pub),
    do: authed(u) |> put("/v1/me/recovery", %{public_key: Base.url_encode64(pub, padding: false)})

  defp sha, do: Base.encode64(:crypto.strong_rand_bytes(32))

  defp seg(u, size \\ 1234) do
    authed(u) |> post("/v1/me/backup/segments", %{size: size, sha256: sha()})
  end

  defp commit(u, ids, manifest \\ :crypto.strong_rand_bytes(100)) do
    authed(u)
    |> put("/v1/me/backup/manifest", %{manifest: Base.encode64(manifest), segments: ids})
  end

  test "needs the recovery phrase", %{u: u} do
    assert %{"error" => %{"code" => "recovery_off"}} = seg(u) |> json_response(409)
    assert authed(u) |> get("/v1/me/backup") |> json_response(404)
  end

  test "upload, commit, restore, compact, delete", %{u: u, pub: pub} do
    on(u, pub) |> json_response(200)
    %{"id" => a, "upload_url" => url} = seg(u) |> json_response(200)
    assert url =~ "backup/"
    %{"id" => b} = seg(u) |> json_response(200)

    m = :crypto.strong_rand_bytes(300)

    assert %{"on" => true, "bytes" => 2468, "segments" => 2} =
             commit(u, [a, b], m) |> json_response(200)

    assert %{"manifest" => got, "segments" => segs} =
             authed(u) |> get("/v1/me/backup/manifest") |> json_response(200)

    assert Base.decode64!(got) == m
    assert segs |> Enum.map(& &1["id"]) |> Enum.sort() == Enum.sort([a, b])
    assert Enum.all?(segs, &(&1["url"] =~ "backup/"))

    # compaction: a new segment replaces both
    %{"id" => c} = seg(u) |> json_response(200)
    assert %{"segments" => 1, "bytes" => 1234} = commit(u, [c]) |> json_response(200)

    assert %{"segments" => [%{"id" => ^c}]} =
             authed(u) |> get("/v1/me/backup/manifest") |> json_response(200)

    assert authed(u) |> delete("/v1/me/backup") |> response(204)
    assert authed(u) |> get("/v1/me/backup") |> json_response(404)
  end

  test "rejects unknown, duplicate and size-mismatched segments", %{u: u, pub: pub} do
    on(u, pub) |> json_response(200)
    %{"id" => a} = seg(u) |> json_response(200)
    %{"id" => wrong} = seg(u, 999) |> json_response(200)

    assert %{"error" => %{"code" => "segment_missing"}} =
             commit(u, [a, Ecto.UUID.generate()]) |> json_response(409)

    assert commit(u, [a, a]) |> json_response(422)

    assert %{"error" => %{"code" => "segment_missing"}} =
             commit(u, [a, wrong]) |> json_response(409)

    assert seg(u, 5_000_000) |> json_response(422)

    assert authed(u)
           |> post("/v1/me/backup/segments", %{size: 10, sha256: "AAAA"})
           |> json_response(422)
  end

  test "another account can't use my segments", %{u: u, pub: pub, conn: conn} do
    on(u, pub) |> json_response(200)
    %{"id" => a} = seg(u) |> json_response(200)
    v = onboarded(conn)
    {pub2, _} = :crypto.generate_key(:eddsa, :ed25519)
    on(v, pub2) |> json_response(200)
    assert commit(v, [a]) |> json_response(409)
  end

  test "new words or recovery off delete the backup", %{u: u, pub: pub} do
    on(u, pub) |> json_response(200)
    %{"id" => a} = seg(u) |> json_response(200)
    commit(u, [a]) |> json_response(200)

    {pub2, _} = :crypto.generate_key(:eddsa, :ed25519)
    on(u, pub2) |> json_response(200)
    assert authed(u) |> get("/v1/me/backup") |> json_response(404)

    %{"id" => b} = seg(u) |> json_response(200)
    commit(u, [b]) |> json_response(200)
    authed(u) |> delete("/v1/me/recovery") |> response(204)
    assert authed(u) |> get("/v1/me/backup") |> json_response(404)
  end

  test "sweep drops unfinished uploads after 24 h", %{u: u, pub: pub} do
    on(u, pub) |> json_response(200)
    %{"id" => _} = seg(u) |> json_response(200)

    Thirstr.Repo.query!(
      "UPDATE chat_backup_segments SET created_at = now() - interval '25 hours'"
    )

    Thirstr.ChatBackup.sweep()
    assert %{rows: [[0]]} = Thirstr.Repo.query!("SELECT count(*) FROM chat_backup_segments")
  end
end
