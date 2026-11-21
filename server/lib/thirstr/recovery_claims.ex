defmodule Thirstr.RecoveryClaims do
  @moduledoc """
  F-22 R-22.20–R-22.26 (#178): "Get my account back" with identity checks. No human path: nothing
  here is reachable from the admin console (AC-22.4).

  1. The claimer is signed in on a new phone with any method (finds the account, no lookup).
  2. Fresh selfie check on the phone (F-03 liveness + on-device face match against the verified
     photos). Like F-03, the server only gets a one-time nonce back with the result; images and
     templates never leave the phone (R-03.5). Unverified accounts skip it and wait 72 h.
  3. Hold: 24 h when another device was used in the last 14 days, else 1 h. Other devices get a
     push + in-app banner and can cancel only with their own passing selfie.
  4. Take back: every other device signed out, other sign-in methods removed, recovery phrase off.

  A second claim within 7 days of a selfie-backed cancel is a conflict: the account is paused and
  nobody wins until one side stops (R-22.22).
  """
  import Ecto.Query, only: [from: 2]
  alias Thirstr.{Accounts, Nearby, Notify, Recovery, Repo, Valkey}
  alias Thirstr.Accounts.{Account, Device, Passkey}

  @methods ~w(apple google passkey email)
  @active ~w(started selfie_passed holding ready conflict)
  @max_attempts 3
  @claims_per_30d 3
  @nonce_ttl 600
  @lock_s 24 * 3600

  def start(%Account{} = a, device_id, params) do
    method = params["method"]

    with :ok <- check(method in @methods, :method, "apple, google, passkey or email"),
         :ok <- check(a.status not in ~w(banned deleted), :account, "not available"),
         :ok <- not_locked(a),
         :ok <- check(count_30d(a) < @claims_per_30d, :account, "too many tries this month") do
      conflict? = recent_selfie_cancel?(a)
      verified? = not is_nil(a.verified_at)

      state =
        cond do
          conflict? -> "conflict"
          verified? -> "started"
          true -> "holding"
        end

      hold = if state == "holding", do: DateTime.add(DateTime.utc_now(), 72 * 3600, :second)
      id = Ecto.UUID.generate()

      {n, _} =
        Repo.insert_all(
          "recovery_claims",
          [
            %{
              id: Nearby.dump(id),
              account_id: Nearby.dump(a.id),
              device_id: Nearby.dump(device_id),
              install_hash: :crypto.hash(:sha256, device_id),
              method: method,
              state: state,
              hold_ends_at: hold
            }
          ],
          on_conflict: :nothing
        )

      if n == 1 do
        event(a.id, device_id, "claim_started")

        if conflict? do
          Accounts.pause(a)
          event(a.id, device_id, "claim_conflict")
        end

        if state == "holding", do: warn_others(a)
        {:ok, view(id)}
      else
        {:error, {:conflict_code, "claim_active", "A claim is already running"}}
      end
    end
  end

  @doc "One-time nonce for the selfie check (claimer or a cancelling device)."
  def challenge(%Account{} = a, claim_id, purpose) when purpose in [:claim, :cancel] do
    with {:ok, c} <- active(a, claim_id) do
      nonce = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)

      Valkey.put_term(
        "rcn:" <> nonce,
        %{claim: c.id, account: a.id, purpose: purpose},
        @nonce_ttl
      )

      {:ok, %{nonce: nonce, steps: Enum.take(Enum.shuffle(~w(left right up blink smile)), 3)}}
    end
  end

  @doc "POST /auth/recovery/claim/:id/selfie {nonce, passed}."
  def selfie(%Account{} = a, device_id, claim_id, %{"nonce" => n, "passed" => passed})
      when is_binary(n) and is_boolean(passed) do
    with {:ok, c} <- active(a, claim_id),
         :ok <- check(c.device_id == device_id, :claim, "not this phone"),
         :ok <- check(c.state == "started", :claim, "not waiting for a selfie"),
         :ok <- nonce(n, a, c, :claim) do
      if passed do
        others? = others_active?(a, device_id)
        hold_s = if others?, do: 24 * 3600, else: 3600
        ends = DateTime.add(DateTime.utc_now(), hold_s, :second)
        set(c.id, state: "holding", hold_ends_at: ends)
        event(a.id, device_id, "selfie_passed")
        if others?, do: warn_others(a)
        {:ok, view(c.id)}
      else
        attempts = c.attempts + 1
        event(a.id, device_id, "selfie_failed")

        if attempts >= @max_attempts do
          set(c.id, state: "expired", attempts: attempts, ended_at: DateTime.utc_now())
          Valkey.command(["SET", "rclock:" <> a.id, "1", "EX", "#{@lock_s}"])
        else
          set(c.id, attempts: attempts)
        end

        {:error,
         {:unprocessable, "recovery_check_failed",
          "That didn't work. #{max(0, @max_attempts - attempts)} tries left."}}
      end
    end
  end

  def selfie(_, _, _, _),
    do: {:error, {:validation, %{nonce: ["required"], passed: ["required"]}}}

  @doc "Another signed-in device stops the claim: needs device auth (on the phone) + a passing selfie."
  def cancel_from_other(%Account{} = a, device_id, claim_id, %{"nonce" => n, "passed" => true})
      when is_binary(n) do
    with {:ok, c} <- active(a, claim_id),
         :ok <- check(c.device_id != device_id, :claim, "use Cancel on the claiming phone"),
         :ok <- nonce(n, a, c, :cancel) do
      set(c.id, state: "cancelled", ended_at: DateTime.utc_now())
      event(a.id, device_id, "claim_cancelled_selfie")
      Notify.event(a.id, "recovery.claim", %{id: c.id, state: "cancelled"})
      :ok
    end
  end

  def cancel_from_other(_, _, _, _),
    do:
      {:error,
       {:unprocessable, "recovery_check_failed", "A passing selfie check is needed to stop it."}}

  @doc "The claimer gives up."
  def withdraw(%Account{} = a, device_id, claim_id) do
    with {:ok, c} <- active(a, claim_id),
         :ok <- check(c.device_id == device_id, :claim, "not this phone") do
      set(c.id, state: "cancelled", ended_at: DateTime.utc_now())
      event(a.id, device_id, "claim_withdrawn")
      :ok
    end
  end

  def show(%Account{} = a, claim_id) do
    case claim(a, claim_id) do
      {:ok, c} -> {:ok, view(c.id)}
      e -> e
    end
  end

  @doc "Active claim for the banner on other devices (S-84c other phone)."
  def current(%Account{id: aid}, device_id \\ nil) do
    case Repo.query!(
           "SELECT id::text, device_id::text FROM recovery_claims WHERE account_id = $1 AND state IN ('started','holding','selfie_passed','ready','conflict') LIMIT 1",
           [Nearby.dump(aid)]
         ).rows do
      [[id, dev]] ->
        mine = not is_nil(device_id) and dev == device_id
        v = Map.put(view(id), :mine, mine)
        # other phones only hear about a claim once its selfie passed (R-22.23)
        if mine or v.state in ~w(holding ready), do: v

      _ ->
        nil
    end
  end

  @doc "POST /auth/recovery/claim/:id/complete: the take-back (R-22.22 step 4)."
  def complete(%Account{} = a, device_id, claim_id) do
    with {:ok, c} <- active(a, claim_id),
         :ok <- check(c.device_id == device_id, :claim, "not this phone"),
         :ok <-
           check(
             c.state == "holding" and DateTime.compare(DateTime.utc_now(), c.hold_ends_at) != :lt,
             :claim,
             "the hold isn't over"
           ) do
      removed = take_back(a, device_id, c.method)
      set(c.id, state: "completed", ended_at: DateTime.utc_now())
      event(a.id, device_id, "claim_completed")
      {:ok, %{signed_out: removed.devices, removed_methods: removed.methods}}
    end
  end

  defp take_back(%Account{id: aid} = a, device_id, method) do
    others =
      Repo.all(
        from(d in Device, where: d.account_id == ^aid and d.id != ^device_id, select: d.id)
      )

    Recovery.sign_out_others(a, device_id)

    methods =
      [
        method != "email" and not is_nil(a.email_hash) && "email",
        method not in ~w(apple google) and not is_nil(a.auth_oidc_hash) && "apple_google",
        "recovery_phrase"
      ]
      |> Enum.filter(& &1)

    changes =
      [email_hash: method == "email", auth_oidc_hash: method in ~w(apple google)]
      |> Enum.reject(fn {_, keep?} -> keep? end)
      |> Enum.map(fn {k, _} -> {k, nil} end)

    if changes != [],
      do: Repo.update_all(from(x in Account, where: x.id == ^aid), set: changes)

    # Passkeys: keep only the most recently used one when it was the way in.
    keep =
      if method == "passkey",
        do:
          Repo.one(
            from(p in Passkey,
              where: p.account_id == ^aid,
              order_by: [desc: p.updated_at],
              limit: 1,
              select: p.id
            )
          )

    pk = from(p in Passkey, where: p.account_id == ^aid)
    {n_pk, _} = Repo.delete_all(if(keep, do: from(p in pk, where: p.id != ^keep), else: pk))

    Recovery.delete(a)

    %{
      devices: length(others),
      methods: if(n_pk > 0, do: ["passkeys" | methods], else: methods)
    }
  end

  # ------------------------------------------------------------------ helpers

  defp view(id) do
    [[id, state, ends, attempts, method]] =
      Repo.query!(
        "SELECT id::text, state, hold_ends_at, attempts, method FROM recovery_claims WHERE id = $1",
        [Nearby.dump(id)]
      ).rows
      |> Nearby.utc()

    %{
      id: id,
      state: if(state == "holding" and ends && past?(ends), do: "ready", else: state),
      hold_ends_at: ends,
      attempts_left: max(0, @max_attempts - attempts),
      method: method
    }
  end

  defp past?(t), do: DateTime.compare(DateTime.utc_now(), t) != :lt

  defp claim(%Account{id: aid}, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         [[cid, did, state, ends, attempts, method]] <-
           Repo.query!(
             "SELECT id::text, device_id::text, state, hold_ends_at, attempts, method FROM recovery_claims WHERE id = $1 AND account_id = $2",
             [Nearby.dump(id), Nearby.dump(aid)]
           ).rows
           |> Nearby.utc() do
      {:ok,
       %{
         id: cid,
         device_id: did,
         state: state,
         hold_ends_at: ends,
         attempts: attempts,
         method: method
       }}
    else
      _ -> {:error, :not_found}
    end
  end

  defp active(a, id) do
    case claim(a, id) do
      {:ok, %{state: s} = c} when s in @active -> {:ok, c}
      {:ok, _} -> {:error, {:conflict_code, "claim_over", "This claim has ended"}}
      e -> e
    end
  end

  defp set(id, kv) do
    Repo.update_all(from(c in "recovery_claims", where: c.id == ^Nearby.dump(id)), set: kv)
  end

  defp nonce(n, a, c, purpose) do
    case Valkey.take_term("rcn:" <> n) do
      %{claim: cid, account: aid, purpose: ^purpose} when cid == c.id and aid == a.id -> :ok
      _ -> {:error, {:validation, %{nonce: ["expired or already used"]}}}
    end
  end

  defp others_active?(%Account{id: aid}, device_id) do
    since = Date.add(Date.utc_today(), -14)

    Repo.exists?(
      from(d in Device,
        where:
          d.account_id == ^aid and d.id != ^device_id and is_nil(d.revoked_at) and
            d.last_seen_day >= ^since
      )
    )
  end

  defp warn_others(%Account{id: aid}) do
    Notify.event(aid, "recovery.claim", %{state: "holding"})
  end

  defp count_30d(%Account{id: aid}) do
    Repo.one(
      from(c in "recovery_claims",
        where: c.account_id == ^Nearby.dump(aid) and c.created_at > ago(30, "day"),
        select: count()
      )
    )
  end

  defp recent_selfie_cancel?(%Account{id: aid}) do
    Repo.exists?(
      from(e in "security_events",
        where:
          e.account_id == ^Nearby.dump(aid) and e.kind == "claim_cancelled_selfie" and
            e.at > ago(7, "day")
      )
    )
  end

  defp not_locked(%Account{id: aid}) do
    case Valkey.command(["TTL", "rclock:" <> aid]) do
      {:ok, t} when is_integer(t) and t > 0 ->
        {:error, {:forbidden, "Too many tries. Try again in #{div(t, 3600) + 1} h."}}

      _ ->
        :ok
    end
  end

  defp event(aid, device_id, kind) do
    Repo.insert_all("security_events", [
      %{
        account_id: Nearby.dump(aid),
        kind: kind,
        install_hash: device_id && :crypto.hash(:sha256, device_id)
      }
    ])
  end

  @doc "Retention: 1 year."
  def sweep do
    %{num_rows: a} =
      Repo.query!("DELETE FROM security_events WHERE at < now() - interval '1 year'", [])

    %{num_rows: b} =
      Repo.query!(
        "DELETE FROM recovery_claims WHERE created_at < now() - interval '1 year'",
        []
      )

    # Claims whose phone never came back within 7 d after the hold
    Repo.query!(
      "UPDATE recovery_claims SET state = 'expired', ended_at = now() WHERE state IN ('started','holding') AND coalesce(hold_ends_at, created_at) < now() - interval '7 days'",
      []
    )

    a + b
  end

  defp check(true, _, _), do: :ok
  defp check(_, f, m), do: {:error, {:validation, %{f => [m]}}}
end
