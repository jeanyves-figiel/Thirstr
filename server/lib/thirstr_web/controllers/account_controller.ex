defmodule ThirstrWeb.AccountController do
  @moduledoc "Own account (F-01 R-01.9/R-01.10) and onboarding steps (F-02)."
  use ThirstrWeb, :controller

  alias Thirstr.{Accounts, Onboarding}
  alias ThirstrWeb.{MeJSON, Plugs}

  action_fallback ThirstrWeb.FallbackController

  def me(conn, _), do: json(conn, MeJSON.me(conn.assigns.account))

  def pause(conn, _) do
    with {:ok, a} <- Accounts.pause(conn.assigns.account), do: json(conn, MeJSON.me(a))
  end

  def resume(conn, _) do
    with {:ok, a} <- Accounts.resume(conn.assigns.account), do: json(conn, MeJSON.me(a))
  end

  @doc "R-01.10: client confirms with biometrics, then sends confirm=DELETE."
  def delete(conn, %{"confirm" => "DELETE"}) do
    with :ok <- Accounts.delete_account(conn.assigns.account), do: send_resp(conn, 202, "")
  end

  def delete(_conn, _), do: {:error, {:validation, %{confirm: ["type DELETE to confirm"]}}}

  # --- onboarding

  def basics(conn, params) do
    with {:ok, {a, _profile}} <-
           Onboarding.save_basics(conn.assigns.account, params, Plugs.Auth.install_key(conn)) do
      json(conn, MeJSON.me(a))
    end
  end

  @doc "RF-7: POST /me/email {email} → 202, link sent to confirm."
  def add_email(conn, params) do
    Thirstr.Auth.EmailLink.request_attach(params["email"], conn.assigns.account.id)
    send_resp(conn, 202, "")
  end

  def photo_later(conn, _) do
    with {:ok, a} <- Onboarding.photo_later(conn.assigns.account), do: json(conn, MeJSON.me(a))
  end

  def verify_later(conn, _) do
    with {:ok, a} <- Onboarding.verify_later(conn.assigns.account), do: json(conn, MeJSON.me(a))
  end
end
