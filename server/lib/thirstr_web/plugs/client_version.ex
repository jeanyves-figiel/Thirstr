defmodule ThirstrWeb.Plugs.ClientVersion do
  @moduledoc """
  EN-14 (#173): reads `x-thirstr-platform` / `x-thirstr-build` / `x-thirstr-install` into
  `conn.assigns.client` and answers 426 `upgrade_required` to native builds below the minimum.
  Builds that send no build number (older apps, web) are let through.
  """
  import Plug.Conn
  alias Thirstr.Flags

  @open ~w(/v1/config /v1/health)

  def init(opts), do: opts

  def call(conn, _opts) do
    ctx =
      Flags.ctx(
        header(conn, "x-thirstr-platform"),
        header(conn, "x-thirstr-build"),
        header(conn, "x-thirstr-install")
      )

    conn = assign(conn, :client, ctx)

    if conn.request_path not in @open and Flags.too_old?(ctx) do
      conn
      |> put_status(426)
      |> Phoenix.Controller.json(%{
        error: %{code: "upgrade_required", message: "Update Thirstr to keep using it"}
      })
      |> halt()
    else
      conn
    end
  end

  defp header(conn, name), do: conn |> get_req_header(name) |> List.first()
end
