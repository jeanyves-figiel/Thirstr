import Config

config :thirstr, Thirstr.Repo,
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :thirstr, ThirstrWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: false,
  secret_key_base: "dev-only-secret-key-base-not-for-staging-or-prod-0000000000000000000",
  watchers: []

config :thirstr, dev_routes: true

config :logger, :console, format: "[$level] $message\n"
config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
config :swoosh, :api_client, false
