defmodule ThirstrWeb.SupportController do
  @moduledoc "F-22 (#178): help votes, contact requests (in-app replies), feedback, recovery claims."
  use ThirstrWeb, :controller
  alias Thirstr.{Feedback, Help, RecoveryClaims, Support}
  action_fallback ThirstrWeb.FallbackController

  # ---------------------------------------------------------------- help + contact

  def vote(conn, p), do: with(:ok <- Help.vote(p), do: send_resp(conn, 204, ""))

  def create(conn, p) do
    with {:ok, r} <- Support.create(conn.assigns[:account], p, owner(conn)),
         do: conn |> put_status(201) |> json(r)
  end

  def upload(conn, p), do: with({:ok, r} <- Support.upload(owner(conn), p), do: json(conn, r))

  def index(conn, _), do: json(conn, %{requests: Support.list(conn.assigns.account)})

  def show(conn, %{"id" => id}),
    do: with({:ok, r} <- Support.thread(conn.assigns.account, id), do: json(conn, r))

  def message(conn, %{"id" => id} = p) do
    with :ok <- Support.reply(conn.assigns.account, id, p),
         do: send_resp(conn, 201, "")
  end

  def solve(conn, %{"id" => id}),
    do: with(:ok <- Support.solve(conn.assigns.account, id), do: send_resp(conn, 204, ""))

  def feedback(conn, p),
    do: with(:ok <- Feedback.create(conn.assigns.account, p), do: send_resp(conn, 202, ""))

  # Signed in: the account. Signed out: a hash of the client IP (uploads + limits only).
  defp owner(conn) do
    case conn.assigns[:account] do
      %{id: id} ->
        id

      _ ->
        "ip:" <> Base.encode16(:crypto.hash(:sha256, :inet.ntoa(conn.remote_ip) |> to_string()))
    end
  end

  # ---------------------------------------------------------------- recovery claims (R-22.22)

  def claim_start(conn, p) do
    with {:ok, r} <- RecoveryClaims.start(conn.assigns.account, conn.assigns.device_id, p),
         do: conn |> put_status(201) |> json(r)
  end

  def claim_current(conn, _),
    do: json(conn, %{claim: RecoveryClaims.current(conn.assigns.account, conn.assigns.device_id)})

  def claim_show(conn, %{"id" => id}),
    do: with({:ok, r} <- RecoveryClaims.show(conn.assigns.account, id), do: json(conn, r))

  def claim_challenge(conn, %{"id" => id} = p) do
    purpose = if p["purpose"] == "cancel", do: :cancel, else: :claim

    with {:ok, r} <- RecoveryClaims.challenge(conn.assigns.account, id, purpose),
         do: json(conn, r)
  end

  def claim_selfie(conn, %{"id" => id} = p) do
    with {:ok, r} <-
           RecoveryClaims.selfie(conn.assigns.account, conn.assigns.device_id, id, p),
         do: json(conn, r)
  end

  def claim_cancel(conn, %{"id" => id} = p) do
    with :ok <-
           RecoveryClaims.cancel_from_other(conn.assigns.account, conn.assigns.device_id, id, p),
         do: send_resp(conn, 204, "")
  end

  def claim_withdraw(conn, %{"id" => id}) do
    with :ok <- RecoveryClaims.withdraw(conn.assigns.account, conn.assigns.device_id, id),
         do: send_resp(conn, 204, "")
  end

  def claim_complete(conn, %{"id" => id}) do
    with {:ok, r} <- RecoveryClaims.complete(conn.assigns.account, conn.assigns.device_id, id),
         do: json(conn, r)
  end
end
