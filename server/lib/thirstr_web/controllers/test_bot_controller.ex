defmodule ThirstrWeb.TestBotController do
  @moduledoc "POST /v1/testbot/session (testing.md › Chat test bots): staging only, `x-testbot-key`."
  use ThirstrWeb, :controller
  alias Thirstr.TestBot

  action_fallback ThirstrWeb.FallbackController

  def session(conn, params) do
    if TestBot.key_ok?(conn |> get_req_header("x-testbot-key") |> List.first()) do
      with {:ok, s} <- TestBot.session(params) do
        json(conn, Map.take(s, [:access_token, :refresh_token, :expires_in, :profile_id]))
      end
    else
      {:error, :not_found}
    end
  end
end
