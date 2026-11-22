defmodule ThirstrWeb.AccountDataController do
  @moduledoc "B4d: data export (R-01.11), linked devices (R-01.6), linked accounts (I-01), share links (I-02)."
  use ThirstrWeb, :controller
  alias Thirstr.{ChatBackup, DeviceAttest, Transfer, DeviceLink, Export, Linked, Recovery, Social}

  action_fallback ThirstrWeb.FallbackController

  defp me(conn), do: conn.assigns.account
  defp done(:ok, conn), do: send_resp(conn, 204, "")
  defp done({:ok, r}, conn), do: json(conn, r)
  defp done(e, _), do: e

  def export(conn, _) do
    with {:ok, _} <- Social.limit(me(conn), "export", 3, 86_400) do
      conn
      |> put_resp_header("content-disposition", ~s(attachment; filename="thirstr-export.json"))
      |> put_resp_header("cache-control", "no-store")
      |> json(Export.build(me(conn)))
    end
  end

  # devices
  def devices(conn, _), do: json(conn, DeviceLink.devices(me(conn), conn.assigns.device_id))
  def remove_device(conn, %{"id" => id}), do: DeviceLink.remove(me(conn), id) |> done(conn)

  # F-01 R-01.16 passkeys in Account
  def passkeys(conn, _), do: json(conn, %{passkeys: Thirstr.Accounts.list_passkeys(me(conn))})

  def remove_passkey(conn, %{"id" => id}),
    do: Thirstr.Accounts.remove_passkey(me(conn), id) |> done(conn)

  def link_start(conn, p), do: DeviceLink.start(me(conn), p) |> done(conn)
  def link_status(conn, %{"code" => c}), do: DeviceLink.status(me(conn), c) |> done(conn)
  def link_confirm(conn, %{"code" => c}), do: DeviceLink.confirm(me(conn), c) |> done(conn)

  # #25 device attestation
  defp dev(conn), do: conn.assigns.device_id
  def attest_status(conn, _), do: json(conn, DeviceAttest.status(dev(conn)))

  def attest_challenge(conn, _) do
    with {:ok, _} <- Social.limit(me(conn), "attest", 20, 3600),
         do: DeviceAttest.challenge(dev(conn)) |> done(conn)
  end

  def attest(conn, p), do: DeviceAttest.attest(dev(conn), p) |> done(conn)
  def assert(conn, p), do: DeviceAttest.assert(dev(conn), p) |> done(conn)

  # R-01.7 recovery phrase + sealed backup
  def recovery_status(conn, _), do: json(conn, Recovery.status(me(conn)))
  def recovery_put(conn, p), do: Recovery.put_key(me(conn), p) |> done(conn)
  def recovery_delete(conn, _), do: Recovery.delete(me(conn)) |> done(conn)
  def vault_get(conn, _), do: Recovery.get_vault(me(conn)) |> done(conn)

  def vault_put(conn, p) do
    with {:ok, _} <- Social.limit(me(conn), "vault", 30, 86_400),
         do: Recovery.put_vault(me(conn), p) |> done(conn)
  end

  # R-01.15 opt-in chat backup (#146)
  def backup_status(conn, _), do: ChatBackup.status(me(conn)) |> done(conn)
  def backup_segment(conn, p), do: ChatBackup.new_segment(me(conn), p) |> done(conn)
  def backup_commit(conn, p), do: ChatBackup.commit(me(conn), p) |> done(conn)
  def backup_get(conn, _), do: ChatBackup.get(me(conn)) |> done(conn)
  def backup_delete(conn, _), do: ChatBackup.delete(me(conn)) |> done(conn)

  # R-01.14 history transfer to a new phone (#146)
  def xfer_create(conn, p), do: Transfer.create(me(conn), dev(conn), p) |> done(conn)
  def xfer_incoming(conn, _), do: Transfer.incoming(me(conn), dev(conn)) |> done(conn)
  def xfer_get(conn, %{"id" => id}), do: Transfer.get(me(conn), dev(conn), id) |> done(conn)

  def xfer_chunk(conn, %{"id" => id} = p),
    do: Transfer.chunk(me(conn), dev(conn), id, p) |> done(conn)

  def xfer_ready(conn, %{"id" => id, "n" => n}),
    do: Transfer.ready(me(conn), dev(conn), id, n) |> done(conn)

  def xfer_ack(conn, %{"id" => id} = p),
    do: Transfer.ack(me(conn), dev(conn), id, p) |> done(conn)

  def xfer_finish(conn, %{"id" => id} = p),
    do: Transfer.finish(me(conn), dev(conn), id, p) |> done(conn)

  def xfer_cancel(conn, %{"id" => id}), do: Transfer.cancel(me(conn), dev(conn), id) |> done(conn)

  def link_claim(conn, p) do
    case DeviceLink.claim(p) do
      {:waiting, r} -> conn |> put_status(202) |> json(r)
      {:ok, session} -> json(conn, ThirstrWeb.MeJSON.session(session))
      e -> e
    end
  end

  # linked accounts
  def linked(conn, %{"id" => pid}), do: Linked.list(me(conn), pid) |> done(conn)

  def link_account(conn, p) do
    with {:ok, r} <- Linked.add(me(conn), p, conn.assigns[:client] || %{}),
         do: conn |> put_status(201) |> json(r)
  end

  def update_linked(conn, %{"id" => id} = p), do: Linked.update(me(conn), id, p) |> done(conn)
  def verify_linked(conn, %{"id" => id} = p), do: Linked.verify(me(conn), id, p) |> done(conn)
  def remove_linked(conn, %{"id" => id}), do: Linked.remove(me(conn), id) |> done(conn)

  # share links
  def get_share(conn, %{"id" => pid}) do
    with {:ok, _} <- Linked.list(me(conn), pid),
         do: json(conn, %{share: Linked.current_share(pid)})
  end

  def share(conn, %{"id" => pid}), do: Linked.share(me(conn), pid) |> done(conn)
  def unshare(conn, %{"id" => pid}), do: Linked.unshare(me(conn), pid) |> done(conn)

  def update_share(conn, %{"id" => pid} = p),
    do: Linked.set_show_photo(me(conn), pid, p["show_photo"]) |> done(conn)

  def share_preview(conn, %{"id" => pid} = p),
    do: Linked.put_preview(me(conn), pid, p["photo_id"], p["jpeg_b64"]) |> done(conn)

  def resolve(conn, %{"slug" => s}), do: Linked.resolve(me(conn), s) |> done(conn)
end
