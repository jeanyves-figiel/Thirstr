import Config

config :thirstr, Thirstr.Repo,
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :thirstr, ThirstrWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test-only-secret-key-base-000000000000000000000000000000000000000000",
  server: false

config :thirstr, Thirstr.Mailer, adapter: Swoosh.Adapters.Test
config :thirstr, Oban, testing: :manual
config :thirstr, dev_routes: true
config :swoosh, :api_client, false
config :logger, level: :warning
config :phoenix, :plug_init_mode, :runtime
config :thirstr, :storage_adapter, Thirstr.Storage.Fake
config :thirstr, :email_link_async, false
config :thirstr, :rate_limit_multiplier, 100
