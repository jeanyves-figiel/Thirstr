defmodule Thirstr.Accounts.Account do
  @moduledoc "accounts table (data-model.md). Never exposed by id in the API."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec]

  @statuses ~w(active paused quarantined suspended banned deleted)
  @steps ~w(basics location photo verify done)

  schema "accounts" do
    field :status, :string, default: "active"
    field :safe_mode, :string, default: "auto"
    field :auth_oidc_hash, :binary
    field :email_hash, :binary
    field :age_confirmed_at, :utc_datetime_usec
    field :birthdate, :date
    field :onboarding_step, :string, default: "basics"
    field :verified_at, :utc_datetime_usec
    field :verification_epoch, :integer, default: 0
    field :paused_at, :utc_datetime_usec
    field :settings, :map, default: %{}
    # Deprecated (#114): merged into Hidden; always false after the migration.
    field :incognito, :boolean, default: false
    field :hidden, :boolean, default: false
    # #114 R-05.7: optional end of Hidden and the level to come back as (city | area).
    field :hidden_until, :utc_datetime
    field :hidden_return, :string
    field :safe_mode_active, :boolean, default: false
    # testing.md › Chat test bot: staging-only automated account (never in prod)
    field :test_bot, :boolean, default: false
    field :test_bot_handle, :string
    has_many :passkeys, Thirstr.Accounts.Passkey
    has_many :devices, Thirstr.Accounts.Device
    has_many :profiles, Thirstr.Profiles.Profile
    timestamps()
  end

  def steps, do: @steps

  def changeset(account, attrs) do
    account
    |> cast(attrs, [
      :status,
      :onboarding_step,
      :birthdate,
      :paused_at,
      :email_hash,
      :auth_oidc_hash
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:onboarding_step, @steps)
    |> unique_constraint(:auth_oidc_hash)
    |> unique_constraint(:email_hash)
  end

  def verified?(%__MODULE__{verified_at: v}), do: not is_nil(v)

  @doc "Accounts younger than 7 days get halved limits and can't see Safe Mode users (R-15.4, F-14)."
  def new?(%__MODULE__{inserted_at: t}), do: DateTime.diff(DateTime.utc_now(), t, :day) < 7

  def safe_mode_on?(%__MODULE__{safe_mode: m, safe_mode_active: act}), do: m == "on" or act
end
