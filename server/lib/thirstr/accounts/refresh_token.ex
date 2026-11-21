defmodule Thirstr.Accounts.RefreshToken do
  @moduledoc "Refresh token (R-01.5): 30 d, bound to device, rotated on use; stored hashed."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec, updated_at: false]

  schema "refresh_tokens" do
    belongs_to :account, Thirstr.Accounts.Account
    belongs_to :device, Thirstr.Accounts.Device
    field :token_hash, :binary
    field :expires_at, :utc_datetime_usec
    field :used_at, :utc_datetime_usec
    timestamps()
  end
end
