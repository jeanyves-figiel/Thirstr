defmodule ThirstrWeb.Plugs.Auth do
  @moduledoc "Bearer access token (R-01.5). Assigns :account and :device_id."
  import Plug.Conn
  alias Thirstr.Accounts

  def init(opts), do: opts

  def call(conn, opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, account, device_id} <- Accounts.authenticate_access(token),
         false <- account.status in ~w(banned deleted),
         :ok <- suspended_ok(conn, account) do
      touch_seen(account.id)
      conn |> assign(:account, account) |> assign(:device_id, device_id)
    else
      {:suspended, conn} ->
        conn
        |> put_status(403)
        |> Phoenix.Controller.json(%{
          error: %{code: "suspended", message: "Your account is suspended. See Account status."}
        })
        |> halt()

      _ ->
        if opts[:optional] do
          conn
        else
          conn
          |> put_status(401)
          |> Phoenix.Controller.json(%{error: %{code: "unauthorized", message: "Sign in again"}})
          |> halt()
        end
    end
  end

  # Suspended accounts (R-15.14) can read, see notices, appeal, sign out and delete; nothing else.
  @suspended_writes [
    ~r{^/v1/me/notices},
    ~r{^/v1/auth/logout},
    ~r{^/v1/account$},
    ~r{^/v1/mls/messages/ack$},
    ~r{^/v1/me/push$},
    # Safety is never blocked (F-13)
    ~r{^/v1/checkin(/.*)?$},
    ~r{^/v1/trusted(/.*)?$}
  ]
  defp suspended_ok(%{method: m}, %{status: "suspended"} = _a) when m in ~w(GET HEAD), do: :ok

  defp suspended_ok(conn, %{status: "suspended"}) do
    if Enum.any?(@suspended_writes, &Regex.match?(&1, conn.request_path)),
      do: :ok,
      else: {:suspended, conn}
  end

  defp suspended_ok(_, _), do: :ok

  # Online dot (F-04): last activity, RAM only, 15 min.
  defp touch_seen(account_id) do
    Thirstr.Valkey.command([
      "SET",
      "seen:" <> account_id,
      Integer.to_string(System.system_time(:second)),
      "EX",
      "900"
    ])
  end

  @doc "Hashed install id (sent by the app) used for the R-02.3 under-age flag."
  def install_key(conn) do
    case get_req_header(conn, "x-thirstr-install") do
      [id] when byte_size(id) in 16..128 -> Thirstr.Ids.hash("install", id) |> Base.encode16()
      _ -> nil
    end
  end
end
