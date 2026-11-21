defmodule Thirstr.Accounts.Device do
  @moduledoc "Device registration (R-01.8: max 5 per account)."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec]

  schema "devices" do
    belongs_to :account, Thirstr.Accounts.Account
    field :platform, :string
    field :attestation_ok, :boolean, default: false

    # #25 iOS App Attest (Thirstr.DeviceAttest): public key + counter, last good attestation/assertion
    field :attest_key_id, :binary
    field :attest_public_key, :binary
    field :attest_counter, :integer
    field :attest_env, :string
    field :attested_at, :utc_datetime_usec
    field :last_seen_day, :date
    # SR-04: soft revoke + resume by the same install (see Accounts.start_session/3)
    field :revoked_at, :utc_datetime_usec
    field :resume_hash, :binary
    timestamps()
  end

  def platforms, do: ~w(ios android web)
end
