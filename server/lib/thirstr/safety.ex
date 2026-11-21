defmodule Thirstr.Safety do
  @moduledoc """
  F-13 beta: trusted-contact relays, meet check-in and panic (F13-safety.md › Beta implementation).

  The server only stores opaque AES-GCM envelopes encrypted on the device with a per-contact key
  that lives in the invite link fragment (AC-13.1). Held alerts are released by `sweep/0` at
  `due_at + 15 min` with the app killed (AC-13.2); contacts are woken by an empty Web Push.
  """
  alias Thirstr.{Notify, Repo, WebPush}
  alias Thirstr.Accounts.Account

  @max_accepted 3
  @max_pending 2
  @max_ct 64 * 1024
  @min_ahead 15 * 60
  @max_ahead 12 * 3600
  @grace 15 * 60
  @ext 30 * 60
  @max_ext 3

  # ------------------------------------------------------------------ owner: contacts

  def invite(%Account{} = a, %{"intro" => intro}) do
    with {:ok, ct} <- ct(intro) do
      [[acc, pend]] =
        q!(
          "SELECT count(*) FILTER (WHERE accepted_at IS NOT NULL), count(*) FILTER (WHERE accepted_at IS NULL) FROM safety_relays WHERE account_id = $1",
          [uuid(a.id)]
        )

      if acc >= @max_accepted or pend >= @max_pending do
        {:error, {:conflict_code, "contacts_full", "You can have up to 3 trusted contacts."}}
      else
        rid = token()
        id = Ecto.UUID.generate()

        q!(
          "INSERT INTO safety_relays (id, account_id, rid_hash, intro, created_at) VALUES ($1, $2, $3, $4, now())",
          [uuid(id), uuid(a.id), hash(rid), ct]
        )

        {:ok, %{id: id, rid: rid}}
      end
    end
  end

  def invite(_, _), do: {:error, {:validation, %{intro: ["required"]}}}

  def contacts(%Account{} = a) do
    rows =
      q!(
        "SELECT id, accepted_at IS NOT NULL, push IS NOT NULL, created_at FROM safety_relays WHERE account_id = $1 ORDER BY created_at",
        [uuid(a.id)]
      )

    %{
      contacts:
        Enum.map(rows, fn [id, acc, push, at] ->
          %{id: Ecto.UUID.cast!(id), accepted: acc, push: push, created_at: at}
        end)
    }
  end

  def remove(%Account{} = a, id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} ->
        q!("DELETE FROM safety_relays WHERE id = $1 AND account_id = $2", [uuid(id), uuid(a.id)])
        :ok

      _ ->
        {:error, :not_found}
    end
  end

  # ------------------------------------------------------------------ owner: check-in

  def current(%Account{} = a) do
    case q!("SELECT due_at, extensions FROM checkins WHERE account_id = $1", [uuid(a.id)]) do
      [[due, ext]] -> %{checkin: %{due_at: due, extensions: ext}}
      [] -> %{checkin: nil}
    end
  end

  def start(%Account{} = a, %{"due_at" => due} = p) do
    now = DateTime.utc_now()

    with {:ok, due, _} <- DateTime.from_iso8601(to_string(due)),
         ahead = DateTime.diff(due, now),
         true <- ahead >= @min_ahead - 60 and ahead <= @max_ahead + 60,
         {:ok, notices} <- envs(a, p["notices"] || []),
         {:ok, alerts} <- envs(a, p["alerts"]),
         true <- alerts != [] do
      token = token()
      id = Ecto.UUID.generate()

      Repo.transaction(fn ->
        case Repo.query(
               "INSERT INTO checkins (id, account_id, token_hash, due_at, created_at) VALUES ($1, $2, $3, $4, now())",
               [uuid(id), uuid(a.id), hash(token), due]
             ) do
          {:ok, _} ->
            hold(uuid(id), alerts)
            release(notices, "notice")

          {:error, _} ->
            Repo.rollback(:active)
        end
      end)
      |> case do
        {:ok, _} ->
          {:ok, %{token: token, due_at: due}}

        {:error, :active} ->
          {:error, {:conflict_code, "checkin_active", "A check-in is already running."}}
      end
    else
      {:error, {:validation, _}} = e ->
        e

      _ ->
        {:error,
         {:validation, %{due_at: ["15 min to 12 h ahead, with at least one accepted contact"]}}}
    end
  end

  def start(_, _), do: {:error, {:validation, %{due_at: ["required"]}}}

  def refresh(%Account{} = a, token, p) do
    with {:ok, id, _} <- checkin(a, token),
         {:ok, alerts} <- envs(a, p["alerts"]),
         {:ok, live} <- envs(a, p["live"] || []) do
      Repo.transaction(fn ->
        q!("DELETE FROM safety_msgs WHERE checkin_id = $1 AND release_at IS NULL", [id])
        hold(id, alerts)
      end)

      release(live, "loc")
      :ok
    end
  end

  def extend(%Account{} = a, token, p) do
    with {:ok, id, ext} <- checkin(a, token),
         true <-
           ext < @max_ext || {:error, {:conflict_code, "max_extensions", "No more extensions."}},
         {:ok, alerts} <- envs(a, p["alerts"]) do
      {:ok, [[due]]} =
        Repo.transaction(fn ->
          q!("DELETE FROM safety_msgs WHERE checkin_id = $1 AND release_at IS NULL", [id])
          hold(id, alerts)

          q!(
            "UPDATE checkins SET due_at = due_at + make_interval(secs => $2), extensions = extensions + 1, due_pushed = false WHERE id = $1 RETURNING due_at",
            [id, @ext]
          )
        end)

      {:ok, %{due_at: due}}
    end
  end

  def ok(%Account{} = a, token, p) do
    with {:ok, id, _} <- checkin(a, token),
         {:ok, oks} <- envs(a, p["oks"] || []) do
      q!("DELETE FROM checkins WHERE id = $1", [id])
      release(oks, "ok")
      :ok
    end
  end

  @doc """
  #127, R-13.21: end the account's running check-in without its token, for a phone that lost its
  local copy (reinstall, wipe). Held alerts go with it (FK cascade); optional `ok` envelopes go to
  the contacts whose keys the phone still has.
  """
  def cancel(%Account{} = a, p) do
    with {:ok, oks} <- envs(a, p["oks"] || []) do
      case q!("DELETE FROM checkins WHERE account_id = $1 RETURNING id", [uuid(a.id)]) do
        [] ->
          {:error, :not_found}

        _ ->
          release(oks, "ok")
          :ok
      end
    end
  end

  @doc "Panic during a check-in (or duress PIN): release now and close the check-in."
  def panic(%Account{} = a, token, p) do
    with {:ok, id, _} <- checkin(a, token),
         {:ok, alerts} <- envs(a, p["alerts"]) do
      q!("DELETE FROM checkins WHERE id = $1", [id])
      release(alerts, "panic")
      :ok
    end
  end

  @doc "In-app SOS without a check-in (R-13.8)."
  def panic(%Account{} = a, p) do
    with {:ok, alerts} <- envs(a, p["alerts"]),
         true <- alerts != [] || {:error, {:validation, %{alerts: ["no accepted contact"]}}} do
      release(alerts, "panic")
      :ok
    end
  end

  defp checkin(a, token) when is_binary(token) do
    case q!("SELECT id, extensions FROM checkins WHERE account_id = $1 AND token_hash = $2", [
           uuid(a.id),
           hash(token)
         ]) do
      [[id, ext]] -> {:ok, id, ext}
      [] -> {:error, :not_found}
    end
  end

  defp checkin(_, _), do: {:error, :not_found}

  # ------------------------------------------------------------------ contact side (no account)

  def relay(rid) do
    case relay_row(rid) do
      {_id, _acc, intro, accepted} ->
        {:ok, %{accepted: accepted, intro: Base.encode64(intro), vapid_key: WebPush.public_key()}}

      nil ->
        {:error, :not_found}
    end
  end

  def accept(rid, p) do
    with {id, acc, _, accepted} <- relay_row(rid) || {:error, :not_found},
         :ok <- accept_room(acc, accepted),
         {:ok, push} <- push_sub(p["push"]) do
      q!(
        "UPDATE safety_relays SET accepted_at = coalesce(accepted_at, now()), push = coalesce($2, push) WHERE id = $1",
        [
          id,
          push
        ]
      )

      :ok
    end
  end

  def set_push(rid, p) do
    with {id, _, _, true} <- relay_row(rid) || {:error, :not_found},
         {:ok, push} when not is_nil(push) <- push_sub(p["push"]) do
      q!("UPDATE safety_relays SET push = $2 WHERE id = $1", [id, push])
      :ok
    else
      {:ok, nil} -> {:error, {:validation, %{push: ["required"]}}}
      {_, _, _, false} -> {:error, :not_found}
      e -> e
    end
  end

  def messages(rid) do
    case relay_row(rid) do
      {id, _, _, true} ->
        rows =
          q!(
            "SELECT id, ciphertext, release_at FROM safety_msgs WHERE relay_id = $1 AND release_at IS NOT NULL ORDER BY id",
            [id]
          )

        {:ok,
         %{
           messages:
             Enum.map(rows, fn [i, c, at] -> %{id: i, ciphertext: Base.encode64(c), at: at} end)
         }}

      {_, _, _, false} ->
        {:ok, %{messages: []}}

      nil ->
        {:error, :not_found}
    end
  end

  def ack(rid, %{"ids" => ids}) when is_list(ids) do
    with {id, _, _, _} <- relay_row(rid) || {:error, :not_found} do
      ids = Enum.filter(ids, &is_integer/1)

      q!(
        "DELETE FROM safety_msgs WHERE relay_id = $1 AND id = ANY($2) AND release_at IS NOT NULL",
        [
          id,
          ids
        ]
      )

      :ok
    end
  end

  def ack(_, _), do: {:error, {:validation, %{ids: ["required"]}}}

  def opt_out(rid) do
    with {id, _, _, _} <- relay_row(rid) || {:error, :not_found} do
      q!("DELETE FROM safety_relays WHERE id = $1", [id])
      :ok
    end
  end

  defp relay_row(rid) when is_binary(rid) and byte_size(rid) in 16..64 do
    case q!(
           "SELECT id, account_id, intro, accepted_at IS NOT NULL FROM safety_relays WHERE rid_hash = $1",
           [
             hash(rid)
           ]
         ) do
      [[id, acc, intro, accepted]] -> {id, acc, intro, accepted}
      [] -> nil
    end
  end

  defp relay_row(_), do: nil

  defp accept_room(_, true), do: :ok

  defp accept_room(acc, false) do
    [[n]] =
      q!("SELECT count(*) FROM safety_relays WHERE account_id = $1 AND accepted_at IS NOT NULL", [
        acc
      ])

    if n < @max_accepted,
      do: :ok,
      else:
        {:error, {:conflict_code, "contacts_full", "This person already has 3 trusted contacts."}}
  end

  defp push_sub(nil), do: {:ok, nil}

  defp push_sub(%{"endpoint" => ep} = s) when is_binary(ep) do
    if WebPush.allowed?(ep),
      do: {:ok, %{"endpoint" => ep, "keys" => s["keys"] || %{}}},
      else: {:error, {:validation, %{push: ["unsupported push service"]}}}
  end

  defp push_sub(_), do: {:error, {:validation, %{push: ["invalid"]}}}

  # ------------------------------------------------------------------ sweep (Minutely)

  def sweep do
    # R-13.6: the owner's "All good?" push at due time (once per due time)
    for [acc] <-
          q!(
            "UPDATE checkins SET due_pushed = true WHERE due_at <= now() AND NOT due_pushed RETURNING account_id",
            []
          ),
        do: Notify.event(Ecto.UUID.cast!(acc), "checkin.due", %{})

    # R-13.7 / AC-13.2: no answer at due + 15 min → release held alerts, wake contacts
    fired =
      q!(
        "SELECT id, account_id FROM checkins WHERE due_at + make_interval(secs => $1) <= now()",
        [
          @grace
        ]
      )

    for [id, acc] <- fired do
      relays =
        Repo.transaction(fn ->
          rel =
            q!(
              "UPDATE safety_msgs SET release_at = now(), checkin_id = NULL WHERE checkin_id = $1 AND release_at IS NULL RETURNING relay_id",
              [id]
            )

          q!("DELETE FROM checkins WHERE id = $1", [id])
          rel |> List.flatten() |> Enum.uniq()
        end)
        |> elem(1)

      wake(relays)
      Notify.event(Ecto.UUID.cast!(acc), "checkin.alert", %{})
    end

    # R-13.10: released envelopes are gone 24 h after release
    q!("DELETE FROM safety_msgs WHERE release_at < now() - interval '24 hours'", [])
    :ok
  end

  # ------------------------------------------------------------------ helpers

  defp hold(checkin_id, alerts) do
    for {relay, ct} <- alerts do
      q!(
        "INSERT INTO safety_msgs (relay_id, checkin_id, kind, ciphertext, created_at) VALUES ($1, $2, 'alert', $3, now())",
        [relay, checkin_id, ct]
      )
    end
  end

  defp release(envs, kind) do
    for {relay, ct} <- envs do
      q!(
        "INSERT INTO safety_msgs (relay_id, kind, ciphertext, release_at, created_at) VALUES ($1, $2, $3, now(), now())",
        [relay, kind, ct]
      )
    end

    envs |> Enum.map(&elem(&1, 0)) |> Enum.uniq() |> wake()
  end

  defp wake([]), do: :ok

  defp wake(relays) do
    q!("SELECT push FROM safety_relays WHERE id = ANY($1) AND push IS NOT NULL", [relays])
    |> Enum.each(fn [sub] -> WebPush.send(sub) end)
  end

  # Envelopes must target the caller's accepted relays; one per relay.
  defp envs(%Account{} = a, list) when is_list(list) and length(list) <= 10 do
    mine =
      q!("SELECT id FROM safety_relays WHERE account_id = $1 AND accepted_at IS NOT NULL", [
        uuid(a.id)
      ])
      |> List.flatten()
      |> MapSet.new()

    Enum.reduce_while(list, {:ok, []}, fn
      %{"relay" => r, "ciphertext" => c}, {:ok, acc} ->
        with {:ok, rid} <- Ecto.UUID.dump(to_string(r)),
             true <- MapSet.member?(mine, rid),
             {:ok, ct} <- ct(c) do
          {:cont, {:ok, [{rid, ct} | acc]}}
        else
          _ -> {:halt, {:error, {:validation, %{relay: ["unknown or not accepted contact"]}}}}
        end

      _, _ ->
        {:halt, {:error, {:validation, %{envelopes: ["invalid"]}}}}
    end)
    |> case do
      {:ok, l} -> {:ok, l |> Enum.reverse() |> Enum.uniq_by(&elem(&1, 0))}
      e -> e
    end
  end

  defp envs(_, _), do: {:error, {:validation, %{envelopes: ["required"]}}}

  defp ct(b64) when is_binary(b64) do
    case Base.decode64(b64) do
      {:ok, bin} when byte_size(bin) > 28 and byte_size(bin) <= @max_ct -> {:ok, bin}
      _ -> {:error, {:validation, %{ciphertext: ["invalid"]}}}
    end
  end

  defp ct(_), do: {:error, {:validation, %{ciphertext: ["invalid"]}}}

  defp token, do: Base.url_encode64(:crypto.strong_rand_bytes(18), padding: false)
  defp hash(t), do: :crypto.hash(:sha256, t)
  defp uuid(id), do: Ecto.UUID.dump!(id)
  # Every caller passes a literal SQL string; values always go through parameters.
  # sobelow_skip ["SQL.Query"]
  defp q!(sql, args), do: Repo.query!(sql, args).rows
end
