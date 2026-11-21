defmodule ThirstrWeb.DevController do
  @moduledoc """
  DEV/test only (compiled out of staging/prod via :dev_routes): mints ID tokens from
  the local dev OIDC issuer so the Apple/Google buttons work on localhost.
  """
  use ThirstrWeb, :controller

  def oidc_token(conn, params) do
    sub = params["sub"] || "dev-" <> Thirstr.Ids.random_token(8)
    json(conn, %{id_token: Thirstr.Auth.OIDC.dev_mint(sub), sub: sub})
  end
end
