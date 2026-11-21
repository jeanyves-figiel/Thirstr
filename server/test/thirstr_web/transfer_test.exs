defmodule ThirstrWeb.TransferTest do
  use ThirstrWeb.ConnCase, async: false

  # F-01 R-01.14 (#146): history transfer from the old phone to the one just linked.
  # The test storage adapter reports every object as 1234 bytes.
  setup %{conn: conn} do
    {:ok, u: onboarded(conn), c: conn}
  end

  defp old(u), do: recycle_authed(u.c)
  defp pub, do: Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)

  # Links a new phone (R-01.6) with one-time transfer keys; returns {code, new-phone conn, keys}.
  defp link(u, c) do
    old_pub = pub()
    new_pub = pub()

    %{"code" => code} =
      old(u) |> post("/v1/devices/link", %{xfer_pub: old_pub}) |> json_response(200)

    assert %{"claim" => claim, "xfer_pub" => ^old_pub} =
             c
             |> recycle()
             |> post("/v1/auth/device-link", %{code: code, platform: "ios", xfer_pub: new_pub})
             |> json_response(202)

    assert %{"state" => "claimed", "xfer_pub" => ^new_pub} =
             old(u) |> get("/v1/devices/link/#{code}") |> json_response(200)

    assert old(u) |> post("/v1/devices/link/#{code}/confirm") |> response(204)

    %{"access_token" => t} =
      c
      |> recycle()
      |> post("/v1/auth/device-link", %{code: code, claim: claim})
      |> json_response(200)

    {code, c |> recycle() |> put_req_header("authorization", "Bearer " <> t)}
  end

  defp new(conn),
    do:
      conn
      |> recycle()
      |> put_req_header("authorization", hd(get_req_header(conn, "authorization")))

  test "send, fetch, ack, done", %{u: u, c: c} do
    assert %{"error" => %{"code" => "not_ready"}} =
             old(u)
             |> post("/v1/devices/transfer", %{link_code: "ABCDEFGH", estimate_bytes: 10})
             |> json_response(409)

    {code, nc} = link(u, c)

    %{"id" => id} =
      old(u)
      |> post("/v1/devices/transfer", %{link_code: code, estimate_bytes: 5000})
      |> json_response(200)

    # nothing ready yet
    assert %{"id" => ^id, "chunks" => []} =
             new(nc) |> get("/v1/devices/transfer/incoming") |> json_response(200)

    %{"upload_url" => url} =
      old(u)
      |> post("/v1/devices/transfer/#{id}/chunks", %{n: 0, size: 1234})
      |> json_response(200)

    assert url =~ "blob/xfer/#{id}/0"
    assert old(u) |> post("/v1/devices/transfer/#{id}/chunks/0/ready") |> response(204)
    assert old(u) |> post("/v1/devices/transfer/#{id}/chunks/0/ready") |> response(204)

    # wrong size never becomes ready
    old(u) |> post("/v1/devices/transfer/#{id}/chunks", %{n: 1, size: 999}) |> json_response(200)

    assert %{"error" => %{"code" => "chunk_missing"}} =
             old(u) |> post("/v1/devices/transfer/#{id}/chunks/1/ready") |> json_response(409)

    assert %{"chunks" => [%{"n" => 0, "url" => _}], "sent" => 1} =
             new(nc) |> get("/v1/devices/transfer/incoming") |> json_response(200)

    # the old phone can't ack, the new phone can't send
    assert old(u) |> post("/v1/devices/transfer/#{id}/ack", %{n: [0]}) |> json_response(404)

    assert new(nc)
           |> post("/v1/devices/transfer/#{id}/chunks", %{n: 2, size: 10})
           |> json_response(404)

    assert new(nc) |> post("/v1/devices/transfer/#{id}/ack", %{n: [0]}) |> response(204)
    assert %{"acked" => 1} = old(u) |> get("/v1/devices/transfer/#{id}") |> json_response(200)
    assert old(u) |> post("/v1/devices/transfer/#{id}/done", %{total: 1}) |> response(204)

    assert %{"state" => "done"} =
             old(u) |> get("/v1/devices/transfer/#{id}") |> json_response(200)

    assert new(nc) |> get("/v1/devices/transfer/incoming") |> json_response(404)

    Thirstr.Transfer.sweep()
    assert old(u) |> get("/v1/devices/transfer/#{id}") |> json_response(404)
  end

  test "cancel from the new phone; another account sees nothing", %{u: u, c: c, conn: conn} do
    {code, nc} = link(u, c)

    %{"id" => id} =
      old(u)
      |> post("/v1/devices/transfer", %{link_code: code, estimate_bytes: 0})
      |> json_response(200)

    v = onboarded(conn)
    assert recycle_authed(v.c) |> get("/v1/devices/transfer/#{id}") |> json_response(404)

    assert recycle_authed(v.c)
           |> post("/v1/devices/transfer", %{link_code: code, estimate_bytes: 0})
           |> json_response(404)

    assert new(nc) |> delete("/v1/devices/transfer/#{id}") |> response(204)
    assert old(u) |> get("/v1/devices/transfer/#{id}") |> json_response(404)
  end

  test "idle transfers are swept after 2 h", %{u: u, c: c} do
    {code, _} = link(u, c)

    %{"id" => id} =
      old(u)
      |> post("/v1/devices/transfer", %{link_code: code, estimate_bytes: 0})
      |> json_response(200)

    Thirstr.Repo.query!("UPDATE device_transfers SET updated_at = now() - interval '3 hours'")
    Thirstr.Transfer.sweep()
    assert old(u) |> get("/v1/devices/transfer/#{id}") |> json_response(404)
  end
end
