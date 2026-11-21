defmodule ThirstrWeb.ClientController do
  @moduledoc "EN-05 (#164): crash/error reports and session pings from the apps (no account needed)."
  use ThirstrWeb, :controller
  alias Thirstr.ClientErrors
  action_fallback ThirstrWeb.FallbackController

  def error(conn, params) do
    with :ok <- ClientErrors.record(params), do: send_resp(conn, 204, "")
  end

  def session(conn, params) do
    with :ok <- ClientErrors.session(params["platform"]), do: send_resp(conn, 204, "")
  end
end
