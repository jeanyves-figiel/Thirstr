import Config

config :swoosh, api_client: Swoosh.ApiClient.Finch, finch_name: Thirstr.Finch
config :swoosh, local: false
config :logger, level: :info
