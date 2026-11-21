defmodule Thirstr.Export do
  @moduledoc """
  R-01.11 Download my data (GDPR Art. 20), beta form: the archive JSON is built on request and
  sent straight to the signed-in device; nothing is stored server-side (beta-build-plan › B4d).
  Device-only data (chats, notes, trusted contacts) is added by the app. Quarantine is never
  listed (R-15.6).
  """
  alias Thirstr.{Repo, Storage}
  alias Thirstr.Accounts.Account

  @mine "(SELECT id FROM profiles WHERE account_id = $1)"

  @sections [
    account:
      "SELECT id, status, safe_mode, birthdate, onboarding_step, verified_at, verification_epoch, hidden, hidden_until, settings, inserted_at AS created_at FROM accounts WHERE id = $1",
    profiles:
      "SELECT id, kind, display_name, age, gender, gender_other, here_for, fields, visibility_map, inserted_at AS created_at, updated_at FROM profiles WHERE account_id = $1",
    location:
      "SELECT profile_id, level, updated_at FROM location_cells WHERE profile_id IN #{@mine}",
    now:
      "SELECT profile_id, status, text, created_at, expires_at FROM now_status WHERE profile_id IN #{@mine}",
    taps_sent:
      "SELECT from_profile_id, to_profile_id, created_at FROM taps WHERE from_profile_id IN #{@mine}",
    taps_received:
      "SELECT from_profile_id, to_profile_id, created_at FROM taps WHERE to_profile_id IN #{@mine}",
    blocks:
      "SELECT account_to AS blocked_account, created_at FROM blocks WHERE account_from = $1",
    hidden_profiles: "SELECT profile_id FROM profile_hides WHERE account_id = $1",
    tonight_plans:
      "SELECT id, profile_id, window_start, window_end, text, tag, audience, created_at, expires_at FROM tonight_plans WHERE profile_id IN #{@mine}",
    parties_hosted:
      "SELECT id, title, starts_at, ends_at, capacity, rules, audience, status, created_at FROM parties WHERE host_profile_id IN #{@mine} OR cohost_profile_id IN #{@mine}",
    party_requests:
      "SELECT party_id, profile_id, state, rating, created_at FROM party_requests WHERE profile_id IN #{@mine}",
    activities:
      "SELECT id, profile_id, club_id, sport, title, place_text, starts_at, capacity, created_at FROM activity_posts WHERE profile_id IN #{@mine}",
    activity_rsvps:
      "SELECT post_id, profile_id, state, created_at FROM activity_rsvps WHERE profile_id IN #{@mine}",
    clubs:
      "SELECT club_id, profile_id, role, state, created_at FROM club_members WHERE profile_id IN #{@mine}",
    venue_checkin:
      "SELECT venue_id, profile_id, visible, zone, checked_in_at FROM venue_checkins WHERE profile_id IN #{@mine}",
    places_added:
      "SELECT id, name, kind, lat, lng, hidden, created_at FROM venues WHERE created_by = $1",
    reports_filed:
      "SELECT reason, context, note, state, created_at FROM reports WHERE reporter_account = $1",
    notices:
      "SELECT action, reason, created_at, ends_at, appeal_state, appeal_text FROM moderation_actions WHERE target_account = $1 AND action <> 'quarantine'",
    vouches_given: "SELECT to_profile, created_at FROM vouches WHERE from_account = $1",
    linked_accounts:
      "SELECT profile_id, platform, handle, visibility, verified_at, created_at FROM linked_accounts WHERE profile_id IN #{@mine}",
    share_links:
      "SELECT profile_id, slug, created_at FROM profile_shares WHERE profile_id IN #{@mine}",
    trusted_contacts:
      "SELECT id, accepted_at, created_at FROM safety_relays WHERE account_id = $1",
    devices:
      "SELECT id, platform, last_seen_day, inserted_at AS created_at FROM devices WHERE account_id = $1",
    # R-01.7: whether a recovery phrase is on (the backup is ciphertext only we can't read)
    recovery_phrase:
      "SELECT inserted_at AS since, vault_updated_at AS backup_at, octet_length(vault) AS backup_bytes FROM account_recovery WHERE account_id = $1",
    # F-20 travel plans
    trips:
      "SELECT t.id, c.name AS city, c.country, t.first_day, t.last_day, t.show_days, t.say_from, t.created_at FROM trips t JOIN cities c ON c.id = t.city_id WHERE t.account_id = $1"
  ]

  def build(%Account{id: id}) do
    arg = [Ecto.UUID.dump!(id)]

    data =
      for {name, sql} <- @sections, into: %{} do
        {name, json_rows(sql, arg)}
      end

    photos =
      Repo.query!(
        "SELECT ph.id::text, ph.profile_id::text, ph.slot, ph.status, ph.storage_key FROM photos ph WHERE ph.profile_id IN #{@mine} ORDER BY ph.profile_id, ph.slot",
        arg
      ).rows
      |> Enum.map(fn [pid, prof, slot, st, key] ->
        %{id: pid, profile_id: prof, slot: slot, status: st, url: Storage.presigned_get(key)}
      end)

    %{
      format: "thirstr-export/1",
      generated_at: DateTime.utc_now(),
      note:
        "Photo URLs expire after 1 hour. Chats, private notes and trusted-contact names live only on your devices and are added by the app.",
      account: List.first(data.account),
      data: data |> Map.delete(:account) |> Map.put(:photos, photos)
    }
  end

  # Section SQL comes from the module attribute above (literals); the only parameter is the account id.
  # sobelow_skip ["SQL.Query"]
  defp json_rows(sql, arg) do
    Repo.query!("SELECT coalesce(json_agg(t), '[]'::json) FROM (" <> sql <> ") t", arg).rows
    |> List.first()
    |> List.first()
  end
end
