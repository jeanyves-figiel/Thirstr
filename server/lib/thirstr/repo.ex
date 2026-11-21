defmodule Thirstr.Repo do
  use Ecto.Repo,
    otp_app: :thirstr,
    adapter: Ecto.Adapters.Postgres
end
