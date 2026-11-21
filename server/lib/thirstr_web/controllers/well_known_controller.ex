defmodule ThirstrWeb.WellKnownController do
  @moduledoc """
  apple-app-site-association: binds the iOS app to this host as a WebAuthn relying
  party (`webcredentials`) and opens `/p/*` share links in the app (`applinks`). App IDs are `<TeamID>.<bundle id>`, from APPLE_TEAM_ID.
  404 until a team is configured.
  """
  use ThirstrWeb, :controller

  def aasa(conn, _) do
    case Application.get_env(:thirstr, :apple_app_ids, []) do
      [] ->
        send_resp(conn, 404, "")

      ids ->
        # Universal links: profile share pages open in the app (I-02 R-I02.3).
        json(conn, %{
          webcredentials: %{apps: ids},
          applinks: %{details: [%{appIDs: ids, components: [%{"/" => "/p/*"}]}]}
        })
    end
  end
end
