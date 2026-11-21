defmodule ThirstrWeb.SafetyController do
  @moduledoc "F-13 trusted contacts, meet check-in, panic (owner) and the contact relay (no account)."
  use ThirstrWeb, :controller
  alias Thirstr.Safety

  action_fallback ThirstrWeb.FallbackController

  defp me(conn), do: conn.assigns.account
  defp done(:ok, conn), do: send_resp(conn, 204, "")
  defp done({:ok, r}, conn), do: json(conn, r)
  defp done(e, _), do: e

  def invite(conn, p) do
    with {:ok, r} <- Safety.invite(me(conn), p), do: conn |> put_status(201) |> json(r)
  end

  def contacts(conn, _), do: json(conn, Safety.contacts(me(conn)))
  def remove(conn, %{"id" => id}), do: Safety.remove(me(conn), id) |> done(conn)

  def current(conn, _), do: json(conn, Safety.current(me(conn)))

  def start(conn, p) do
    with {:ok, r} <- Safety.start(me(conn), p), do: conn |> put_status(201) |> json(r)
  end

  def cancel(conn, p), do: Safety.cancel(me(conn), p) |> done(conn)
  def refresh(conn, %{"token" => t} = p), do: Safety.refresh(me(conn), t, p) |> done(conn)
  def extend(conn, %{"token" => t} = p), do: Safety.extend(me(conn), t, p) |> done(conn)
  def ok(conn, %{"token" => t} = p), do: Safety.ok(me(conn), t, p) |> done(conn)
  def panic_checkin(conn, %{"token" => t} = p), do: Safety.panic(me(conn), t, p) |> done(conn)
  def panic(conn, p), do: Safety.panic(me(conn), p) |> done(conn)

  # contact side
  def relay(conn, %{"rid" => rid}), do: Safety.relay(rid) |> done(conn)
  def accept(conn, %{"rid" => rid} = p), do: Safety.accept(rid, p) |> done(conn)
  def push(conn, %{"rid" => rid} = p), do: Safety.set_push(rid, p) |> done(conn)
  def messages(conn, %{"rid" => rid}), do: Safety.messages(rid) |> done(conn)
  def ack(conn, %{"rid" => rid} = p), do: Safety.ack(rid, p) |> done(conn)
  def opt_out(conn, %{"rid" => rid}), do: Safety.opt_out(rid) |> done(conn)
end
