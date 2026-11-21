defmodule ThirstrWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :thirstr

  # Realtime (api.md › Realtime): user topic for message.new / taps / typing.
  socket "/socket", ThirstrWeb.UserSocket, websocket: [connect_info: []], longpoll: false

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :thirstr
  end

  plug Plug.RequestId
  # Client IP = Fly-Client-IP, which the Fly proxy always overwrites. X-Forwarded-For is not
  # trusted: Plug takes its first entry, which the client controls (rate limits, R-02.2 city).
  plug Plug.RewriteOn, [{:remote_ip, "fly-client-ip"}, :x_forwarded_proto]
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.Head
  plug ThirstrWeb.Plugs.Site
  plug ThirstrWeb.Router
end
