defmodule Thirstr.Accounts.Passkey do
  @moduledoc "WebAuthn credential (F-01 R-01.1). Public key only; private key never leaves the device."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec]

  schema "passkeys" do
    belongs_to :account, Thirstr.Accounts.Account
    field :credential_id, :binary
    field :cose_key, :binary
    field :sign_count, :integer, default: 0
    timestamps()
  end
end
