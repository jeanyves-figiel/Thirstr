defmodule Thirstr.Profiles.Photo do
  @moduledoc "photos table. Slot 0 = main (must be vanilla, R-02.7 / F-15 R-15.10)."
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec, updated_at: false]

  schema "photos" do
    belongs_to :profile, Thirstr.Profiles.Profile
    field :slot, :integer
    field :storage_key, :string
    field :thumb_key, :string
    field :status, :string, default: "pending"
    field :classifier_score, :map, default: %{}
    field :reject_reason, :string
    field :review_state, :string
    timestamps()
  end
end
