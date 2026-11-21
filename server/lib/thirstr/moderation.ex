defmodule Thirstr.Moderation do
  @moduledoc """
  F-15 moderation actions. Shadow quarantine (R-15.6): the account keeps a normal UI, but
  everything it sends or shows reaches nobody until reviewed (AC-15.1).

  Enforcement (R-15.14): warn, remove photo, suspend (1–30 d), ban, release from quarantine.
  Every action is logged in `moderation_actions` with a reason code; visible ones become in-app
  notices with an appeal (R-AD.9).
  """
  import Ecto.Query
  alias Thirstr.Accounts.{Account, RefreshToken}
  alias Thirstr.Profiles.Photo
  alias Thirstr.Repo

  def auto_quarantine(%Account{status: "active"} = a, reason) do
    a |> Ecto.Changeset.change(status: "quarantined") |> Repo.update!()
    log_action(a.id, "quarantine", reason, "system")
    :ok
  end

  def auto_quarantine(_, _), do: :ok

  def log_action(account_id, action, reason, actor, extra \\ %{}) do
    id = Ecto.UUID.generate()

    Repo.insert_all("moderation_actions", [
      Map.merge(
        %{
          id: Ecto.UUID.dump!(id),
          target_account: Ecto.UUID.dump!(account_id),
          action: action,
          reason: reason,
          actor: actor,
          created_at: DateTime.utc_now()
        },
        extra
      )
    ])

    {:ok, id}
  end

  @doc "Moderator action on an account (admin console A-02/A-04). Returns {:ok, action_id}."
  def enforce(account_id, action, reason, actor, opts \\ [])

  def enforce(account_id, "warn", reason, actor, opts),
    do: log_action(account_id, "warn", reason, actor, report(opts))

  def enforce(account_id, "suspend", reason, actor, opts) do
    days = opts[:days] |> to_int() |> max(1) |> min(30)
    ends = DateTime.add(DateTime.utc_now(), days * 86_400, :second)
    set_status(account_id, "suspended")
    log_action(account_id, "suspend", reason, actor, Map.put(report(opts), :ends_at, ends))
  end

  def enforce(account_id, "ban", reason, actor, opts) do
    set_status(account_id, "banned")
    # Signed out everywhere; can't sign back in (Accounts.find_or_create_by/3).
    Repo.delete_all(from(r in RefreshToken, where: r.account_id == ^account_id))
    log_action(account_id, "ban", reason, actor, report(opts))
  end

  def enforce(account_id, "release", reason, actor, opts) do
    set_status(account_id, "active", from: ~w(quarantined suspended))
    log_action(account_id, "release", reason, actor, report(opts))
  end

  def enforce(account_id, "remove_photo", reason, actor, opts) do
    case Repo.get(Photo, opts[:photo_id] || Ecto.UUID.generate()) do
      %Photo{} = ph ->
        ph |> Ecto.Changeset.change(status: "rejected", review_state: "done") |> Repo.update!()
        Thirstr.Profiles.refresh_photo_ids(ph.profile_id)
        log_action(account_id, "remove_photo", reason, actor, report(opts))

      nil ->
        {:error, :not_found}
    end
  end

  def enforce(_, _, _, _, _), do: {:error, {:validation, %{action: ["unknown action"]}}}

  @doc "Appeal decision (A-05): overturn restores the account (suspend/ban) and closes the appeal."
  def decide_appeal(action_id, decision, actor) when decision in ~w(upheld overturned) do
    case Repo.query!(
           "UPDATE moderation_actions SET appeal_state = $2 WHERE id = $1 AND appeal_state = 'open' RETURNING target_account::text, action",
           [Ecto.UUID.dump!(action_id), decision]
         ).rows do
      [[aid, act]] ->
        if decision == "overturned" and act in ~w(suspend ban),
          do: enforce(aid, "release", "appeal_overturned", actor)

        :ok

      _ ->
        {:error, :not_found}
    end
  end

  @doc "Minutely: lift ended suspensions."
  def sweep do
    Repo.query!("""
    UPDATE accounts a SET status = 'active', updated_at = now()
    WHERE a.status = 'suspended' AND NOT EXISTS (
      SELECT 1 FROM moderation_actions m
      WHERE m.target_account = a.id AND m.action = 'suspend' AND m.ends_at > now()
        AND (m.appeal_state IS NULL OR m.appeal_state <> 'overturned'))
    """)
  end

  defp set_status(account_id, status, opts \\ []) do
    q = from(a in Account, where: a.id == ^account_id)
    q = if opts[:from], do: where(q, [a], a.status in ^opts[:from]), else: q
    Repo.update_all(q, set: [status: status, updated_at: DateTime.utc_now()])
  end

  defp report(opts) do
    case opts[:report_id] do
      nil -> %{}
      id -> %{report_id: Ecto.UUID.dump!(id)}
    end
  end

  defp to_int(n) when is_integer(n), do: n
  defp to_int(n) when is_binary(n), do: String.to_integer(n)
  defp to_int(_), do: 1
end
