defmodule ThirstrWeb.TrustController do
  @moduledoc "B4a: reports (S-50), enforcement notices and appeals, vouches."
  use ThirstrWeb, :controller
  alias Thirstr.{Reports, Trust, Verification}
  alias ThirstrWeb.MeJSON

  action_fallback ThirstrWeb.FallbackController

  # F-03 verification (challenge → on-device liveness → blind issue → redeem)
  def verify_challenge(conn, _) do
    with {:ok, r} <- Verification.challenge(conn.assigns.account), do: json(conn, r)
  end

  def verify_issue(conn, p) do
    with {:ok, r} <- Verification.issue(conn.assigns.account, p), do: json(conn, r)
  end

  def verify_redeem(conn, p) do
    with {:ok, a} <- Verification.redeem(conn.assigns.account, p), do: json(conn, MeJSON.me(a))
  end

  def report(conn, p) do
    with {:ok, r} <- Reports.create(conn.assigns.account, p),
         do: conn |> put_status(201) |> json(r)
  end

  def notices(conn, _), do: json(conn, Reports.notices(conn.assigns.account))

  def notices_seen(conn, _) do
    Reports.seen(conn.assigns.account)
    send_resp(conn, 204, "")
  end

  def appeal(conn, %{"id" => id} = p) do
    with :ok <- Reports.appeal(conn.assigns.account, id, p), do: send_resp(conn, 204, "")
  end

  def vouch(conn, %{"id" => id}) do
    with {:ok, r} <- Trust.vouch(conn.assigns.account, id), do: json(conn, r)
  end

  def unvouch(conn, %{"id" => id}) do
    with {:ok, r} <- Trust.unvouch(conn.assigns.account, id), do: json(conn, r)
  end
end
