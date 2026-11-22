import Config

# All environments read infra endpoints from env so DEV compose, CI and Fly share one shape.
env = fn name, default -> System.get_env(name) || default end
test? = config_env() == :test

if System.get_env("PHX_SERVER"), do: config(:thirstr, ThirstrWeb.Endpoint, server: true)

default_db =
  if test?,
    do:
      "ecto://postgres:postgres@localhost:5432/thirstr_test#{System.get_env("MIX_TEST_PARTITION")}",
    else: "ecto://postgres:postgres@localhost:5432/thirstr_dev"

config :thirstr, Thirstr.Repo,
  url: env.("DATABASE_URL", default_db),
  pool_size: String.to_integer(env.("POOL_SIZE", "10")),
  socket_options: if(env.("ECTO_IPV6", "false") in ~w(true 1), do: [:inet6], else: [])

app_url = env.("APP_URL", "https://localhost:7443")

config :thirstr,
  app_url: app_url,
  tiles_upstream: env.("TILES_UPSTREAM", "https://tiles.openfreemap.org"),
  classifier_url: System.get_env("CLASSIFIER_URL"),
  # W-01: canonical marketing host (prod "thirstr.fun"). Other hosts serve the site with noindex.
  site_host: System.get_env("SITE_HOST"),
  valkey_url: env.("VALKEY_URL", "redis://localhost:6379/#{if test?, do: 1, else: 0}"),
  # R-01.2/R-01.3: pepper for identifier hashes. Prod: injected from EU KMS via fly secrets.
  pepper: env.("ID_PEPPER", "dev-pepper-not-secret"),
  # F-16 push (content-free). APNs token auth; DEV/CI post to the mock instead (PUSH_MOCK_URL).
  apns: [
    key_p8: System.get_env("APNS_KEY_P8"),
    key_id: System.get_env("APNS_KEY_ID"),
    team_id: System.get_env("APPLE_TEAM_ID"),
    topic: env.("APNS_TOPIC", "app.thirstr"),
    host: env.("APNS_HOST", "https://api.push.apple.com"),
    mock_url: System.get_env("PUSH_MOCK_URL")
  ],
  # F-16 Android (FCM HTTP v1, SR-02): service-account JSON as a secret; unset = Android skipped.
  fcm: [
    service_account: System.get_env("FCM_SERVICE_ACCOUNT_JSON"),
    mock_url: System.get_env("FCM_MOCK_URL")
  ],
  # AASA webcredentials (I-03): "<TeamID>.<bundle id>" once APPLE_TEAM_ID is set.
  apple_app_ids:
    (case System.get_env("APPLE_TEAM_ID") do
       nil ->
         []

       "" ->
         []

       team ->
         Enum.map(String.split(env.("IOS_BUNDLE_IDS", "app.thirstr"), ","), &"#{team}.#{&1}")
     end),
  # #25 App Attest: keys from Xcode debug builds ("development" aaguid) are refused in prod.
  app_attest_allow_dev: System.get_env("DEPLOY_ENV") not in ["prod", "production"],
  # #270: verification issuance needs device proof (App Attest / Play Integrity) on staging + prod.
  verification_requires_attest:
    env.(
      "VERIFICATION_REQUIRE_ATTEST",
      if(System.get_env("DEPLOY_ENV") in ~w(staging prod production), do: "true", else: "false")
    ) in ~w(true 1),
  # #168 Android Play Integrity: service account JSON as a secret; unset = Android attestation off.
  play_integrity: [
    service_account: System.get_env("PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON"),
    package: env.("ANDROID_PACKAGE", "app.thirstr"),
    cert_digests:
      String.split(System.get_env("PLAY_INTEGRITY_CERT_SHA256") || "", ",", trim: true),
    allow_unrecognized: System.get_env("DEPLOY_ENV") not in ["prod", "production"]
  ],
  # Admin console (admin-console.md, R-AD.12): owner account ids; empty = console off (404).
  admin_account_ids: String.split(System.get_env("ADMIN_ACCOUNT_IDS") || "", ",", trim: true),
  # F-22 (#178): contact alerts go to this address (ImprovMX forwards it to the owner).
  support_address: System.get_env("SUPPORT_ADDRESS") || "support@thirstr.fun",
  # F-22 R-22.32: feedback → GitHub issues. Fine-grained token, Issues write, one repo. Unset = held.
  feedback_github: [
    token: System.get_env("GITHUB_FEEDBACK_TOKEN"),
    repo: System.get_env("GITHUB_FEEDBACK_REPO") || "jeanyves-figiel/Thirstr"
  ],
  # testing.md › Chat test bot: shared key for the bot service; unset = feature off (404).
  # Never honoured when DEPLOY_ENV is prod/production (Thirstr.TestBot.enabled?/0).
  testbot_key: System.get_env("TESTBOT_KEY"),
  # EN-21 (#180) admin Costs & capacity: read-only Fly org token (R-AD.13); unset = Fly typed in.
  # FLY_APP_NAME is set by Fly on every machine (thirstr-api-<env>); the DB app follows the naming.
  fly_cost_token: System.get_env("FLY_COST_TOKEN"),
  # F-15 R-15.56 (#325): live photos sampled per day for the after-publish review (A-03).
  photo_sample_per_day: String.to_integer(env.("PHOTO_SAMPLE_PER_DAY", "20")),
  fly_org: env.("FLY_ORG", "thirstr"),
  fly_api_app: env.("FLY_APP_NAME", "thirstr-api-prod"),
  fly_db_app: String.replace(env.("FLY_APP_NAME", "thirstr-api-prod"), "-api-", "-db-"),
  cost_alert_email: System.get_env("COST_ALERT_EMAIL"),
  webauthn: [
    origin: env.("WEBAUTHN_ORIGIN", app_url),
    rp_id: env.("WEBAUTHN_RP_ID", URI.parse(app_url).host),
    rp_name: "Thirstr"
  ],
  oidc: [
    # Dev/test accept tokens signed by the local dev issuer (see ThirstrWeb.DevController).
    dev_issuer: config_env() in [:dev, :test],
    google_client_ids: String.split(env.("GOOGLE_CLIENT_IDS", ""), ",", trim: true),
    apple_client_ids: String.split(env.("APPLE_CLIENT_IDS", "app.thirstr"), ",", trim: true)
  ],
  storage: [
    bucket: env.("S3_BUCKET", "thirstr-public"),
    # host used by the server itself
    internal_endpoint: env.("S3_ENDPOINT", "http://localhost:9000"),
    # host clients use for presigned PUT/GET
    public_endpoint: env.("S3_PUBLIC_ENDPOINT", "https://localhost:7444"),
    region: env.("S3_REGION", "eu-central-1")
  ]

# R-02.2 (#26): offline DB-IP city file baked into the image; GEO_DB=static keeps the stand-in.
if config_env() == :prod and System.get_env("GEO_DB") != "static" do
  config :thirstr, :ip_geo, Thirstr.Geo.GeoDb
  if path = System.get_env("GEO_DB_PATH"), do: config(:thirstr, :geo_db_path, path)
end

# F-15 R-15.10 (#26): self-hosted NudeNet service, private network (docs/runbooks/classifier.md).
if System.get_env("CLASSIFIER_URL") not in [nil, ""] do
  config :thirstr, :photo_classifier, Thirstr.Moderation.NudeNetClassifier
  config :thirstr, :classifier_token, System.get_env("CLASSIFIER_TOKEN")
end

# F-15 R-15.42 (#179): pre-publish hash match. Staging/prod: noop until the PhotoDNA keys arrive.
if config_env() == :prod or System.get_env("HASH_MATCH_PROVIDER") do
  provider =
    case System.get_env("HASH_MATCH_PROVIDER", "noop") do
      "photodna" -> Thirstr.Moderation.HashMatch.PhotoDNA
      "dev" -> Thirstr.Moderation.HashMatch.Dev
      _ -> Thirstr.Moderation.HashMatch.Noop
    end

  config :thirstr, :hash_match, provider
  config :thirstr, :photodna_key, System.get_env("PHOTODNA_KEY")
  config :thirstr, :photodna_url, System.get_env("PHOTODNA_URL")
  # F-15 R-15.47: evidence key (32 bytes, base64). Unset = derived from SECRET_KEY_BASE.
  config :thirstr, :evidence_key, System.get_env("EVIDENCE_KEY")
end

s3 = URI.parse(env.("S3_ENDPOINT", "http://localhost:9000"))

config :ex_aws,
  access_key_id: env.("S3_ACCESS_KEY", "thirstr"),
  secret_access_key: env.("S3_SECRET_KEY", "thirstr-dev-secret"),
  region: env.("S3_REGION", "eu-central-1"),
  json_codec: Jason,
  http_client: ExAws.Request.Req

config :ex_aws, :s3,
  scheme: "#{s3.scheme}://",
  host: s3.host,
  port: s3.port,
  region: env.("S3_REGION", "eu-central-1")

if config_env() == :dev do
  config :thirstr, Thirstr.Mailer,
    adapter: Swoosh.Adapters.SMTP,
    relay: env.("SMTP_HOST", "localhost"),
    port: String.to_integer(env.("SMTP_PORT", "1025")),
    ssl: false,
    tls: :never,
    auth: :never
end

if config_env() == :prod do
  # F-12 R-12.9: staging + prod import OSM venues weekly unless PLACES_OSM_IMPORT=false.
  config :thirstr, :places,
    osm_import: System.get_env("PLACES_OSM_IMPORT") != "false",
    overpass_url: System.get_env("OSM_OVERPASS_URL") || "https://overpass-api.de/api/interpreter",
    gym_regions: ~w(CH DE AT FR BE NL LU GB ES IT PT)

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") || raise "environment variable SECRET_KEY_BASE is missing"

  System.get_env("ID_PEPPER") || raise "environment variable ID_PEPPER is missing"
  host = env.("PHX_HOST", "localhost")

  config :thirstr, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")
  # SR-07: internal Prometheus port (Fly [metrics]); METRICS_PORT=off disables it.
  config :thirstr,
         :metrics_port,
         (case System.get_env("METRICS_PORT", "9091") do
            "off" -> nil
            port -> String.to_integer(port)
          end)

  config :thirstr, ThirstrWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}, port: String.to_integer(env.("PORT", "4000"))],
    secret_key_base: secret_key_base

  # Sign-in links (F-01 R-01.3, #26): Amazon SES API (SES_REGION) or an SMTP relay with full
  # certificate checks. Runbook: docs/runbooks/email.md. With neither, email sign-in is off.
  config :thirstr, :mail_from, env.("MAIL_FROM", "hello@thirstr.fun")

  cond do
    # Amazon SES HTTPS API (#26): eu-central-2 (Zurich) has no SMTP endpoint, only the API.
    ses_region = System.get_env("SES_REGION") ->
      config :thirstr, Thirstr.Mailer,
        adapter: Swoosh.Adapters.AmazonSES,
        region: ses_region,
        access_key: System.fetch_env!("SES_ACCESS_KEY_ID"),
        secret: System.fetch_env!("SES_SECRET_ACCESS_KEY")

      # R-AD.18 (#326): cost page counts SES recipients as they are sent
      config :thirstr, :meter_ses, true

    smtp = System.get_env("SMTP_HOST") ->
      config :thirstr, Thirstr.Mailer,
        adapter: Swoosh.Adapters.SMTP,
        relay: smtp,
        port: String.to_integer(env.("SMTP_PORT", "587")),
        username: System.get_env("SMTP_USER"),
        password: System.get_env("SMTP_PASSWORD"),
        tls: :always,
        auth: :always,
        no_mx_lookups: true,
        retries: 2,
        tls_options: [
          verify: :verify_peer,
          cacerts: :public_key.cacerts_get(),
          server_name_indication: String.to_charlist(smtp),
          depth: 4,
          versions: [:"tlsv1.2", :"tlsv1.3"],
          customize_hostname_check: [
            match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
          ]
        ]

    true ->
      :ok
  end
end
