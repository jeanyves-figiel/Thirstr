defmodule Thirstr.Profiles.Profile do
  @moduledoc "profiles table (F-06). One per account (R-06.1); `show_in` = lenses it appears in (R-06.1a)."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  @timestamps_opts [type: :utc_datetime_usec]

  # R-02.4 / R-02.5 ("unspecified" = "Prefer not to say", owner decision 2026-11-18, required-fields.md)
  @genders ~w(man trans_man non_binary other unspecified)
  @here_for ~w(hookup tonight chat friends sport)

  schema "profiles" do
    belongs_to :account, Thirstr.Accounts.Account
    field :kind, :string, default: "now"
    field :display_name, :string
    field :age, :integer
    field :gender, :string
    field :gender_other, :string
    field :here_for, {:array, :string}, default: ["hookup", "tonight"]
    field :show_in, {:array, :string}, default: ["hookup"]
    field :visibility_map, :map, default: %{}
    field :photo_ids, {:array, :binary_id}, default: []
    field :completeness, :integer, default: 0
    field :seeded, :boolean, default: false
    field :fields, :map, default: %{}
    field :public_updated_at, :utc_datetime_usec
    has_many :photos, Thirstr.Profiles.Photo
    timestamps()
  end

  @lenses ~w(hookup friends sport)
  def lenses, do: @lenses
  def genders, do: @genders
  def here_for_values, do: @here_for

  # required-fields.md RF-1: display name 1–20 (owner decision 2026-11-18).
  @name_max 20
  def name_max, do: @name_max

  def basics_changeset(profile, attrs) do
    profile
    |> cast(attrs, [:display_name, :gender, :gender_other, :here_for])
    |> update_change(:display_name, &String.trim/1)
    |> put_default_gender()
    |> validate_required([:display_name, :gender])
    |> validate_length(:display_name, min: 1, max: @name_max)
    |> validate_inclusion(:gender, @genders)
    |> validate_gender_other()
    |> validate_subset(:here_for, @here_for)
    |> validate_length(:here_for, min: 1)
  end

  @doc "R-06.1a: Here for → initial lenses (Hookup/Tonight/Chat → hookup; Friends; Sport)."
  def lenses_for(here_for) do
    here_for = here_for || []

    [
      {"hookup", Enum.any?(~w(hookup tonight chat), &(&1 in here_for))},
      {"friends", "friends" in here_for},
      {"sport", "sport" in here_for}
    ]
    |> Enum.filter(&elem(&1, 1))
    |> Enum.map(&elem(&1, 0))
    |> case do
      [] -> ["hookup"]
      l -> l
    end
  end

  @doc "R-06.1a: show_in ⊆ lenses, at least one."
  def show_in_changeset(profile, show_in) do
    profile
    |> cast(%{show_in: show_in}, [:show_in])
    |> validate_required([:show_in], message: "show_in_empty")
    |> validate_subset(:show_in, @lenses)
    |> validate_length(:show_in, min: 1, message: "show_in_empty")
    |> update_change(:show_in, fn l -> Enum.filter(@lenses, &(&1 in l)) end)
  end

  # RF-3: the "I am" step is optional; skipped = "unspecified".
  defp put_default_gender(cs) do
    if get_field(cs, :gender) in [nil, ""], do: put_change(cs, :gender, "unspecified"), else: cs
  end

  defp validate_gender_other(cs) do
    if get_field(cs, :gender) == "other" do
      cs |> validate_required([:gender_other]) |> validate_length(:gender_other, max: 20)
    else
      put_change(cs, :gender_other, nil)
    end
  end
end
