defmodule Thirstr.Verification do
  @moduledoc """
  F-03 verification, beta form (beta-build-plan.md › Liveness, Anonymous credential).

  1. `challenge/1`: server nonce + 3 random liveness steps, single use, 5 min (R-03.1, AC-03.3).
  2. The device runs liveness on device (Apple Vision); no image or template leaves it (R-03.5).
  3. `issue/2`: on a passed result for a live nonce the server blind-signs the client's blinded
     token (Chaum RSA-FDH, 3072-bit, SHA-384) — it never sees the token itself (R-03.4).
  4. `redeem/2`: the client sends the unblinded token + signature; valid and unspent → verified,
     epoch + 1. The spent-token table holds sha256(token) only.

  Failures: 3 in 24 h → 24 h cooldown (R-03.10). Credentials expire after 12 months (R-03.7).
  """
  alias Thirstr.{Repo, Valkey}
  alias Thirstr.Accounts.Account

  # #131: blink dropped from the pool (too short to catch on still photos; client still accepts it).
  @steps ~w(turn_left turn_right smile look_up)
  @nonce_ttl 300
  @max_fails 3
  @cooldown 24 * 3600
  @bits 3072

  # ------------------------------------------------------------------ challenge

  def challenge(%Account{} = a) do
    with :ok <- not_cooling(a) do
      nonce = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
      steps = @steps |> Enum.shuffle() |> Enum.take(3)
      Valkey.put_term("vnonce:" <> nonce, %{account: a.id, steps: steps}, @nonce_ttl)
      {n, e} = public_key()

      {:ok,
       %{
         nonce: nonce,
         steps: steps,
         expires_in: @nonce_ttl,
         key: %{n: Base.url_encode64(n, padding: false), e: e, bits: @bits, hash: "SHA-384"}
       }}
    end
  end

  # ------------------------------------------------------------------ result + blind issuance

  @doc "POST /verification/attest {nonce, passed, blinded}: consumes the nonce; signs only on pass."
  def issue(%Account{} = a, %{"nonce" => nonce} = p) when is_binary(nonce) do
    with :ok <- not_cooling(a),
         %{account: id} <- Valkey.take_term("vnonce:" <> nonce),
         true <- id == a.id do
      if p["passed"] == true, do: sign(p["blinded"]), else: fail(a)
    else
      _ -> {:error, {:validation, %{nonce: ["expired or already used"]}}}
    end
  end

  def issue(_, _), do: {:error, {:validation, %{nonce: ["required"]}}}

  defp sign(blinded) when is_binary(blinded) do
    with {:ok, bin} <- Base.url_decode64(blinded, padding: false),
         {n, _e, d} <- private_key(),
         m = :binary.decode_unsigned(bin),
         true <- m > 0 and m < :binary.decode_unsigned(n) do
      s = :crypto.mod_pow(m, d, n) |> pad(byte_size(n))
      {:ok, %{signature: Base.url_encode64(s, padding: false)}}
    else
      _ -> {:error, {:validation, %{blinded: ["invalid"]}}}
    end
  end

  defp sign(_), do: {:error, {:validation, %{blinded: ["required"]}}}

  defp fail(a) do
    {:ok, n} = Valkey.hit("vfail:" <> a.id, 1_000_000, @cooldown)
    if n >= @max_fails, do: Valkey.command(["SET", "vcool:" <> a.id, "1", "EX", "#{@cooldown}"])
    {:ok, %{passed: false, attempts_left: max(0, @max_fails - n)}}
  end

  defp not_cooling(a) do
    case Valkey.command(["TTL", "vcool:" <> a.id]) do
      {:ok, t} when is_integer(t) and t > 0 ->
        {:error, {:forbidden, "Too many tries. Try again in #{div(t, 3600) + 1} h."}}

      _ ->
        :ok
    end
  end

  # ------------------------------------------------------------------ redeem

  @doc "POST /verification/redeem {token, signature} → Me (verified)."
  def redeem(%Account{} = a, %{"token" => t, "signature" => s})
      when is_binary(t) and is_binary(s) do
    with {:ok, token} <- Base.url_decode64(t, padding: false),
         true <- byte_size(token) in 32..64,
         {:ok, sig} <- Base.url_decode64(s, padding: false),
         {n, e} <- public_key(),
         true <- :crypto.mod_pow(sig, e, n) |> :binary.decode_unsigned() == fdh(token, n),
         {1, _} <-
           Repo.insert_all(
             "spent_tokens",
             [%{hash: :crypto.hash(:sha256, token), created_at: DateTime.utc_now()}],
             on_conflict: :nothing
           ) do
      Valkey.command(["DEL", "vfail:" <> a.id])

      a
      |> Ecto.Changeset.change(
        verified_at: DateTime.utc_now(),
        verification_epoch: (a.verification_epoch || 0) + 1,
        onboarding_step: if(a.onboarding_step == "verify", do: "done", else: a.onboarding_step)
      )
      |> Repo.update()
    else
      _ -> {:error, {:validation, %{token: ["invalid or already used"]}}}
    end
  end

  def redeem(_, _), do: {:error, {:validation, %{token: ["required"]}}}

  @doc "Daily: credentials older than 12 months lapse (R-03.7)."
  def sweep do
    Repo.query!(
      "UPDATE accounts SET verified_at = NULL WHERE verified_at < now() - interval '12 months'"
    )
  end

  # ------------------------------------------------------------------ RSA-FDH

  @doc "Full-domain hash: MGF1-SHA-384(token) to |n| bytes, reduced mod n (client does the same)."
  def fdh(token, n) do
    len = byte_size(n)

    out =
      Stream.iterate(0, &(&1 + 1))
      |> Enum.reduce_while(<<>>, fn i, acc ->
        if byte_size(acc) >= len,
          do: {:halt, acc},
          else: {:cont, acc <> :crypto.hash(:sha384, token <> <<i::32>>)}
      end)
      |> binary_part(0, len)

    rem(:binary.decode_unsigned(out), :binary.decode_unsigned(n))
  end

  defp pad(bin, len) when byte_size(bin) < len,
    do: :binary.copy(<<0>>, len - byte_size(bin)) <> bin

  defp pad(bin, _), do: bin

  @doc "{modulus bytes, e} of the issuer key."
  def public_key do
    {n, e, _d} = private_key()
    {n, e}
  end

  defp private_key do
    case :persistent_term.get({__MODULE__, :key}, nil) do
      nil ->
        k = load_or_create()
        :persistent_term.put({__MODULE__, :key}, k)
        k

      k ->
        k
    end
  end

  defp load_or_create do
    der =
      case Repo.query!("SELECT der FROM server_keys WHERE name = 'verify_rsa'").rows do
        [[der]] ->
          der

        [] ->
          key = :public_key.generate_key({:rsa, @bits, 65_537})
          der = :public_key.der_encode(:RSAPrivateKey, key)

          Repo.query!(
            "INSERT INTO server_keys (name, der, created_at) VALUES ('verify_rsa', $1, now()) ON CONFLICT DO NOTHING",
            [der]
          )

          [[der]] = Repo.query!("SELECT der FROM server_keys WHERE name = 'verify_rsa'").rows
          der
      end

    {:RSAPrivateKey, _, n, e, d, _, _, _, _, _, _} = :public_key.der_decode(:RSAPrivateKey, der)
    {:binary.encode_unsigned(n), e, :binary.encode_unsigned(d)}
  end
end
