import Config

config :thirstr,
  ecto_repos: [Thirstr.Repo],
  generators: [timestamp_type: :utc_datetime_usec, binary_id: true]

config :thirstr, ThirstrWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [formats: [json: ThirstrWeb.ErrorJSON], layout: false],
  pubsub_server: Thirstr.PubSub

config :thirstr, Thirstr.Mailer, adapter: Swoosh.Adapters.Local

config :thirstr, Oban,
  repo: Thirstr.Repo,
  queues: [default: 10, maintenance: 2, push: 10],
  # SR-03: let running jobs finish on SIGTERM (Fly kill_timeout is 30 s).
  shutdown_grace_period: :timer.seconds(25),
  plugins: [
    {Oban.Plugins.Pruner, max_age: 3600},
    # Jobs left "executing" by a restart (e.g. a deploy during the Places import) go back to the queue.
    {Oban.Plugins.Lifeline, rescue_after: :timer.minutes(45)},
    {Oban.Plugins.Cron,
     crontab: [
       {"*/15 * * * *", Thirstr.Jobs.ExpirySweep},
       {"* * * * *", Thirstr.Jobs.Minutely},
       # F-12 R-12.9: weekly OSM venue import (no-op unless :places osm_import is on)
       {"30 3 * * 1", Thirstr.Jobs.PlaceImport}
     ]}
  ]

# F-12 R-12.9 (#113): OSM import. Gym countries are chosen by the team, never derived from users.
config :thirstr, :places,
  osm_import: false,
  overpass_url: "https://overpass-api.de/api/interpreter",
  gym_regions: ~w(CH DE AT FR BE NL LU GB ES IT PT)

# Product rules (spec references inline)
config :thirstr, :auth,
  # R-01.5
  access_ttl_s: 15 * 60,
  refresh_ttl_s: 30 * 24 * 3600,
  # R-01.3
  magic_link_ttl_s: 15 * 60,
  # R-01.8
  max_devices: 5,
  # R-02.3: device flagged 30 d after under-age birthday
  underage_flag_ttl_s: 30 * 24 * 3600

config :thirstr, :photo_classifier, Thirstr.Moderation.DevClassifier
config :thirstr, :ip_geo, Thirstr.Geo.StaticIpGeo

# No account ids, no IPs in logs (security.md controls)
config :logger, :console, format: "$time $metadata[$level] $message\n", metadata: [:request_id]

config :phoenix, :json_library, Jason

config :phoenix,
       :filter_parameters,
       ~w(email token id_token refresh attestation assertion birthdate)

import_config "#{config_env()}.exs"
