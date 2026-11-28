defmodule ThirstrWeb.ProbeController do
  @moduledoc "EN-23 OB-2: synthetic chat probe (`x-probe-key`). 404 when the key is wrong or unset."
  use ThirstrWeb, :controller
  alias Thirstr.Probe

  action_fallback ThirstrWeb.FallbackController

  def session(conn, params) do
    with :ok <- key(conn), {:ok, s} <- Probe.session(params), do: json(conn, s)
  end

  def report(conn, params) do
    with :ok <- key(conn), :ok <- Probe.report(params), do: send_resp(conn, 204, "")
  end

  defp key(conn) do
    if Probe.key_ok?(conn |> get_req_header("x-probe-key") |> List.first()),
      do: :ok,
      else: {:error, :not_found}
  end
end
