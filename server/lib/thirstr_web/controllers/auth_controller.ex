defmodule ThirstrWeb.AuthController do
  @moduledoc "F-01 auth endpoints (api.md › Auth)."
  use ThirstrWeb, :controller

  alias Thirstr.{Accounts, Recovery}
  alias Thirstr.Auth.{EmailLink, OIDC, Passkeys}
  alias ThirstrWeb.{MeJSON, Plugs}

  action_fallback ThirstrWeb.FallbackController

  # --- passkey (R-01.1)

  def passkey_register_options(conn, _), do: json(conn, Passkeys.registration_options())

  def passkey_register(conn, params) do
    with :ok <- not_flagged(conn),
         {:ok, cred_id, cose, count} <- Passkeys.verify_registration(params) do
      register_passkey(conn, conn.assigns[:account], params, {cred_id, cose, count})
    end
  end

  # Signed-in account adds a passkey (F-01 edge case: OIDC account later adds passkey).
  defp register_passkey(conn, %Accounts.Account{} = a, _params, {cred_id, cose, count}) do
    with {:ok, _} <- Accounts.add_passkey(a, cred_id, cose, count), do: send_resp(conn, 204, "")
  end

  defp register_passkey(conn, nil, params, {cred_id, cose, count}) do
    with {:ok, a} <- Accounts.create_account(%{}, age_confirmed: params["age_confirmed"] == true),
         {:ok, _} <- Accounts.add_passkey(a, cred_id, cose, count),
         {:ok, session} <- Accounts.start_session(a, params["platform"] || "web", resume(conn)) do
      conn |> put_status(201) |> json(MeJSON.session(session))
    end
  end

  def passkey_login_options(conn, _), do: json(conn, Passkeys.authentication_options())

  def passkey_login(conn, params) do
    with {:ok, a} <- Passkeys.verify_authentication(params),
         :ok <- usable(a),
         {:ok, session} <- Accounts.start_session(a, params["platform"] || "web", resume(conn)) do
      json(conn, MeJSON.session(session))
    end
  end

  # --- recovery phrase (R-01.7, #25)

  def recovery_options(conn, _), do: Recovery.options() |> then(fn {:ok, r} -> json(conn, r) end)

  def recovery(conn, params) do
    with {:ok, a} <- Recovery.verify(params),
         :ok <- usable(a),
         {:ok, session} <- Accounts.start_session(a, params["platform"] || "web", resume(conn)),
         :ok <- Recovery.sign_out_others(a, session.device_id) do
      json(conn, MeJSON.session(session))
    end
  end

  # --- OIDC (R-01.2)

  def oidc(conn, %{"provider" => provider, "id_token" => token} = params) do
    with :ok <- not_flagged(conn),
         {:ok, hash} <- OIDC.verify(provider, token),
         {:ok, a, kind} <-
           Accounts.find_or_create_by(:auth_oidc_hash, hash,
             age_confirmed: params["age_confirmed"] == true
           ),
         :ok <- usable(a),
         {:ok, session} <- Accounts.start_session(a, params["platform"] || "web", resume(conn)) do
      conn
      |> put_status(if(kind == :created, do: 201, else: 200))
      |> json(MeJSON.session(session))
    end
  end

  def oidc(_conn, _), do: {:error, :validation}

  # --- email magic link (R-01.3): always 202

  def email_link(conn, params) do
    EmailLink.request(params["email"], age_confirmed: params["age_confirmed"] == true)
    send_resp(conn, 202, "")
  end

  def email_verify(conn, params) do
    with :ok <- not_flagged(conn),
         {:ok, a, kind} <- EmailLink.verify(params["token"]),
         :ok <- usable(a),
         {:ok, session} <- Accounts.start_session(a, params["platform"] || "web", resume(conn)) do
      conn
      |> put_status(if(kind == :created, do: 201, else: 200))
      |> json(MeJSON.session(session))
    end
  end

  # --- tokens (R-01.5)

  def refresh(conn, %{"refresh" => token}) do
    with {:ok, session} <- Accounts.refresh(token), do: json(conn, MeJSON.session(session))
  end

  def refresh(_conn, _), do: {:error, :validation}

  def logout(conn, _) do
    Accounts.logout_device(conn.assigns.device_id)
    send_resp(conn, 204, "")
  end

  def logout_all(conn, _) do
    Accounts.logout_all(conn.assigns.account)
    send_resp(conn, 204, "")
  end

  defp usable(%{status: s}) when s in ~w(banned deleted), do: {:error, :forbidden}
  defp usable(_), do: :ok

  defp not_flagged(conn) do
    if Accounts.underage_flagged?(Plugs.Auth.install_key(conn)),
      do: {:error, :underage_blocked},
      else: :ok
  end

  # SR-04: the install's previous device, sent by the app on every sign-in.
  defp resume(conn) do
    with [id] <- get_req_header(conn, "x-thirstr-device"),
         [secret] <- get_req_header(conn, "x-thirstr-device-secret") do
      %{"device_id" => id, "secret" => secret}
    else
      _ -> nil
    end
  end
end
