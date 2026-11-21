defmodule Thirstr.DeviceAttest do
  @moduledoc """
  #25 device attestation (security.md › Device attestation). iOS only for now (App Attest);
  Android Play Integrity follows with the Android build, web never attests.

  1. `challenge/1`: 32 random bytes as base64url (43 chars), single use, 5 min, bound to the device (Valkey).
  2. `attest/2` once per install: verifies the attestation (Thirstr.AppAttest), stores the public key,
     sets `attestation_ok` and `attested_at`.
  3. `assert/2` at most daily: assertion over a fresh challenge with that key, growing counter;
     refreshes `attested_at`. A device not re-asserted for 7 days counts as unattested.
  Soft in beta: unattested clients keep working; `attested?/1` feeds anti-bot signals (F-15).
  """
  import Ecto.Query
  alias Thirstr.{AppAttest, Repo, Valkey}
  alias Thirstr.Accounts.Device

  @ttl 300
  @fresh_days 7

  def challenge(device_id) do
    c = :crypto.strong_rand_bytes(32)
    Valkey.put_term(key(c), device_id, @ttl)
    {:ok, %{challenge: b64(c), expires_in: @ttl}}
  end

  def attest(device_id, %{"key_id" => kid, "attestation" => att, "challenge" => ch}) do
    with {:ok, kid} <- unb64(kid),
         {:ok, att} <- unb64(att),
         {:ok, ch} <- take(ch, device_id),
         %Device{} = d <- Repo.get(Device, device_id) || {:error, :not_found},
         {:ok, %{public_key: pub, env: env}} <-
           AppAttest.verify_attestation(att, kid, ch, app_ids()),
         :ok <- env_allowed(env) do
      d
      |> Ecto.Changeset.change(
        attest_key_id: kid,
        attest_public_key: pub,
        attest_counter: 0,
        attest_env: Atom.to_string(env),
        attestation_ok: true,
        attested_at: DateTime.utc_now()
      )
      |> Repo.update!()

      {:ok, %{attested: true}}
    else
      {:error, :not_found} = e ->
        e

      {:error, :challenge} ->
        {:error, {:unprocessable, "challenge", "Challenge expired, ask for a new one"}}

      {:error, reason} ->
        {:error, {:unprocessable, "attestation_invalid", "Attestation failed (#{reason})"}}
    end
  end

  def attest(_, _), do: {:error, {:validation, %{attestation: ["required"]}}}

  def assert(device_id, %{"assertion" => a, "challenge" => ch}) do
    with {:ok, a} <- unb64(a),
         {:ok, ch} <- take(ch, device_id),
         %Device{attest_public_key: pub, attest_counter: n} = d when is_binary(pub) <-
           Repo.get(Device, device_id) || {:error, :not_found},
         {:ok, counter} <- AppAttest.verify_assertion(a, ch, pub, n || 0, app_ids()) do
      d
      |> Ecto.Changeset.change(
        attest_counter: counter,
        attestation_ok: true,
        attested_at: DateTime.utc_now()
      )
      |> Repo.update!()

      {:ok, %{attested: true}}
    else
      %Device{} ->
        {:error, {:conflict_code, "not_attested", "Attest this device first"}}

      {:error, :not_found} = e ->
        e

      {:error, :challenge} ->
        {:error, {:unprocessable, "challenge", "Challenge expired, ask for a new one"}}

      {:error, reason} ->
        {:error, {:unprocessable, "assertion_invalid", "Assertion failed (#{reason})"}}
    end
  end

  def assert(_, _), do: {:error, {:validation, %{assertion: ["required"]}}}

  @doc "Attested within the last #{@fresh_days} days."
  def attested?(device_id) do
    since = DateTime.add(DateTime.utc_now(), -@fresh_days * 86_400)

    Repo.exists?(
      from(d in Device, where: d.id == ^device_id and d.attestation_ok and d.attested_at > ^since)
    )
  end

  def status(device_id) do
    case Repo.get(Device, device_id) do
      %Device{} = d ->
        %{
          attested: attested?(device_id),
          has_key: d.attest_key_id != nil,
          attested_at: d.attested_at
        }

      _ ->
        %{attested: false, has_key: false, attested_at: nil}
    end
  end

  # Single use (GETDEL). The app signs the challenge *string* as sent (UTF-8; @expo/app-integrity
  # hashes `Data(challenge.utf8)` as clientDataHash), so the string itself is the client data.
  defp take(ch, device_id) when is_binary(ch) and byte_size(ch) == 43 do
    with {:ok, raw} <- unb64(ch),
         ^device_id <- Valkey.take_term(key(raw)) do
      {:ok, ch}
    else
      _ -> {:error, :challenge}
    end
  end

  defp take(_, _), do: {:error, :challenge}

  # Development-environment keys (Xcode debug builds) are only accepted outside prod.
  defp env_allowed(:production), do: :ok

  defp env_allowed(:development),
    do:
      if(Application.get_env(:thirstr, :app_attest_allow_dev, true),
        do: :ok,
        else: {:error, :environment}
      )

  defp app_ids,
    do:
      Application.get_env(:thirstr, :app_attest_app_ids) ||
        Application.get_env(:thirstr, :apple_app_ids, [])

  defp key(raw), do: "attest:" <> Base.url_encode64(raw, padding: false)
  defp b64(b), do: Base.url_encode64(b, padding: false)

  defp unb64(s) when is_binary(s) do
    s = s |> String.replace("+", "-") |> String.replace("/", "_") |> String.trim_trailing("=")

    case Base.url_decode64(s, padding: false) do
      {:ok, b} -> {:ok, b}
      :error -> {:error, :malformed}
    end
  end

  defp unb64(_), do: {:error, :malformed}
end
