defmodule ThirstrWeb.Plugs.RateLimit do
  @moduledoc "Per hashed-IP fixed-window limits for unauthenticated endpoints (api.md › Rate limits)."
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, opts) do
    key = "rl:ip:#{opts[:bucket]}:" <> Thirstr.Ids.ip_hash(conn)

    limit = opts[:limit] * Application.get_env(:thirstr, :rate_limit_multiplier, 1)

    case Thirstr.Valkey.hit(key, limit, opts[:window]) do
      {:ok, _} ->
        conn

      {:error, :rate_limited, retry} ->
        conn
        |> put_resp_header("retry-after", Integer.to_string(retry))
        |> put_status(429)
        |> Phoenix.Controller.json(%{
          error: %{code: "rate_limited", message: "Slow down", retry_after: retry}
        })
        |> halt()
    end
  end
end
