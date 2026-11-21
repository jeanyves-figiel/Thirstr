defmodule ThirstrWeb.MeJSON do
  @moduledoc "Own-account view. Never includes account id, email or birthdate."
  alias Thirstr.Accounts.Account
  alias Thirstr.{Location, Profiles, Repo, Settings, Social, Storage}

  def me(%Account{} = a) do
    profiles = Profiles.list_own(a)
    main = Enum.find(profiles, &(&1.kind == "now"))

    %{
      # Shadow quarantine is never revealed to the account (R-15.6).
      status: if(a.status == "quarantined", do: "active", else: a.status),
      verified: Account.verified?(a),
      verified_since: a.verified_at && Calendar.strftime(a.verified_at, "%Y-%m"),
      onboarding_step: a.onboarding_step,
      safe_mode: a.safe_mode,
      safe_mode_active: a.safe_mode_active,
      hidden: a.hidden,
      # #114 R-05.7: when Hidden ends (nil = until I switch) and the level to come back as.
      hidden_until: a.hidden && a.hidden_until,
      hidden_return: a.hidden && a.hidden_return,
      member_since: a.inserted_at && Calendar.strftime(a.inserted_at, "%Y-%m"),
      # RF-7: whether a sign-in email is on file (the address itself is never stored).
      has_email: not is_nil(a.email_hash),
      created_at: a.inserted_at,
      profile: main && profile(main),
      profiles: Enum.map(profiles, &profile/1),
      location: main && location(a, main.id),
      now: main && Social.now_of(main.id),
      settings: Settings.get(a)
    }
  end

  # SR-04: device_id + device_secret only on sign-in (the install keeps them to resume later).
  def session(%{access_token: at, refresh_token: rt, expires_in: exp, account: a} = s) do
    %{access_token: at, refresh_token: rt, expires_in: exp, account: me(a)}
    |> then(fn m ->
      if s[:device_secret],
        do: Map.merge(m, %{device_id: s.device_id, device_secret: s.device_secret}),
        else: m
    end)
  end

  def photo(ph) do
    %{
      id: ph.id,
      slot: ph.slot,
      status: ph.status,
      reject_reason: ph.reject_reason,
      main_ok: Map.get(ph.classifier_score || %{}, "main_ok", ph.status == "ok_main"),
      url:
        if(ph.status in ~w(ok_main ok_public pending), do: Storage.presigned_get(ph.storage_key)),
      thumb_url:
        if(ph.status in ~w(ok_main ok_public) and ph.thumb_key,
          do: Storage.presigned_get(ph.thumb_key)
        )
    }
  end

  def profile(p) do
    %{
      id: p.id,
      kind: p.kind,
      display_name: p.display_name,
      age: p.age,
      gender: p.gender,
      gender_other: p.gender_other,
      here_for: p.here_for,
      show_in: p.show_in,
      fields: p.fields || %{},
      visibility_map: p.visibility_map || %{},
      completeness: p.completeness,
      photos: p.photos |> Enum.reject(&(&1.status == "rejected")) |> Enum.map(&photo/1)
    }
  end

  defp location(a, profile_id) do
    # cell_r5: caller's own coarse cell, only for centring their own map (R-04.13).
    {level, cell_r5} =
      case Repo.query!(
             "SELECT level, cell_r5::h3index::text FROM location_cells WHERE profile_id = $1",
             [
               Ecto.UUID.dump!(profile_id)
             ]
           ).rows do
        [[level, cell]] -> {level, cell}
        _ -> {if(a.hidden, do: "hidden"), nil}
      end

    %{
      level: level,
      cell_r5: cell_r5,
      pin: Location.own_pin_info(a),
      hide_from_hidden: Location.hide_from_hidden?(a),
      # #197 R-05.13 "Show closer distance" choice (applies on Area)
      precise: Thirstr.Settings.get(a, "precise_distance") == true
    }
  end
end
