defmodule Thirstr.Onboarding do
  @moduledoc """
  F-02 Onboarding state machine: basics → location → photo → verify → done.
  Spec: docs/spec/features/F02-onboarding.md. The server keeps the step so a killed
  app resumes at the last incomplete step.
  """
  import Ecto.Query
  alias Thirstr.{Accounts, Repo}
  alias Thirstr.Accounts.Account
  alias Thirstr.Profiles.{Photo, Profile}

  @next %{"basics" => "location", "location" => "photo", "photo" => "verify", "verify" => "done"}

  def main_profile(%Account{id: id}),
    do:
      Repo.one(
        from p in Profile,
          where: p.account_id == ^id and p.kind == "now",
          preload: [photos: ^from(ph in Photo, order_by: ph.slot)]
      )

  # ------------------------------------------------------------- S-03 Basics

  @doc "R-02.3: under 18 → account deleted, install flagged 30 d."
  def save_basics(%Account{} = a, attrs, install_key) do
    with {:ok, birthdate} <- parse_date(attrs["birthdate"]),
         age = age_on(birthdate, Date.utc_today()),
         :ok <- check_age(a, age, install_key) do
      Repo.transaction(fn -> write_basics(a, attrs, age, birthdate) end)
    end
  end

  defp check_age(a, age, install_key) when age < 18 do
    Accounts.delete_account(a)
    if install_key, do: Accounts.flag_underage_device(install_key)
    {:error, :underage}
  end

  defp check_age(_a, age, _key) when age > 99,
    do: {:error, {:validation, %{birthdate: ["is not valid"]}}}

  defp check_age(_a, _age, _key), do: :ok

  defp write_basics(a, attrs, age, birthdate) do
    profile = main_profile(a) || %Profile{account_id: a.id, kind: "now"}

    changeset =
      profile
      |> Profile.basics_changeset(attrs)
      |> Ecto.Changeset.put_change(:age, age)
      # R-06.1a: Here for sets the initial lenses.
      |> then(
        &Ecto.Changeset.put_change(
          &1,
          :show_in,
          Profile.lenses_for(Ecto.Changeset.get_field(&1, :here_for))
        )
      )
      |> then(fn cs ->
        Ecto.Changeset.put_change(
          cs,
          :completeness,
          Thirstr.Profiles.Fields.completeness(%{
            fields: profile.fields,
            photo_ids: profile.photo_ids,
            show_in: Ecto.Changeset.get_field(cs, :show_in)
          })
        )
      end)

    with {:ok, p} <- Repo.insert_or_update(changeset),
         {:ok, a} <- a |> Account.changeset(%{birthdate: birthdate}) |> Repo.update() do
      {advance!(a, "basics"), p}
    else
      {:error, cs} -> Repo.rollback({:validation, errors(cs)})
    end
  end

  def age_on(birthdate, today) do
    years = today.year - birthdate.year
    if {today.month, today.day} < {birthdate.month, birthdate.day}, do: years - 1, else: years
  end

  # ------------------------------------------------------------- S-04 Location

  @doc "R-02.6 / F-05: level chosen here; Hidden only once verified. Client sends H3 cells, never lat/lng."
  def set_location(%Account{} = a, params) do
    with %Profile{} = p <- main_profile(a) || {:error, :basics_required},
         {:ok, _} <- Thirstr.Location.put(a, p, params) do
      {:ok, advance!(a, "location")}
    end
  end

  # ------------------------------------------------------------- S-05 Photo

  def create_photo_upload(%Account{} = a, slot, content_type) do
    with %Profile{} = p <- main_profile(a) || {:error, :basics_required} do
      Thirstr.Profiles.create_photo_upload(a, p.id, slot, content_type)
    end
  end

  @doc "R-02.7: classify after upload; inline result. Main photo (slot 0) must be :ok_main."
  def check_photo(%Account{} = a, photo_id) do
    with %Profile{} = p <- main_profile(a) || {:error, :not_found},
         {:ok, ph, _p} <- Thirstr.Profiles.check_photo(a, p.id, photo_id) do
      a = if ph.slot == 0 and ph.status == "ok_main", do: advance!(a, "photo"), else: a
      {:ok, ph, a}
    end
  end

  @doc """
  RF-6 (required-fields.md): the main photo can be added later. The account moves on
  to verify; Explore keeps it invisible until a main photo passes (no photo, no card).
  """
  def photo_later(%Account{onboarding_step: "photo"} = a), do: {:ok, advance!(a, "photo")}

  def photo_later(%Account{} = a),
    do: {:error, {:conflict, "onboarding step is #{a.onboarding_step}"}}

  # ------------------------------------------------------------- S-06 Verify

  @doc "R-02.8: Later → browse-only on Explore. Verification itself is F-03."
  def verify_later(%Account{onboarding_step: "verify"} = a), do: {:ok, advance!(a, "verify")}

  def verify_later(%Account{} = a),
    do: {:error, {:conflict, "onboarding step is #{a.onboarding_step}"}}

  # ------------------------------------------------------------- helpers

  defp advance!(%Account{onboarding_step: step} = a, step) do
    a |> Ecto.Changeset.change(onboarding_step: @next[step]) |> Repo.update!()
  end

  defp advance!(a, _), do: a

  defp parse_date(s) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, d} -> {:ok, d}
      _ -> {:error, {:validation, %{birthdate: ["must be YYYY-MM-DD"]}}}
    end
  end

  defp parse_date(_), do: {:error, {:validation, %{birthdate: ["can't be blank"]}}}

  def errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
