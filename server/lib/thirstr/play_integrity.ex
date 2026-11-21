defmodule Thirstr.PlayIntegrity do
  @moduledoc """
  Android Play Integrity (#168, security.md › Device attestation, I-03). Standard requests:
  the app asks Google Play for a token bound to a `requestHash`; the server sends the token to
  Google's `decodeIntegrityToken` and checks the verdict itself (`check/4`, pure).

  Accepted: request hash matches, our package, `PLAY_RECOGNIZED` app (or `UNRECOGNIZED_VERSION`
  outside prod, for side-loaded test builds), device `MEETS_DEVICE_INTEGRITY` or stronger, token
  younger than 5 minutes, signing certificate in `PLAY_INTEGRITY_CERT_SHA256` when that is set.

  Config (`:thirstr, :play_integrity`): `service_account` (JSON, secret; unset = Android
  attestation off), `package` (default `app.thirstr`), `cert_digests`, `allow_unrecognized`.
  Google sees only the token; no user data goes with it.
  """

  @max_age_ms 5 * 60_000
  @scope "https://www.googleapis.com/auth/playintegrity"

  def enabled?, do: cfg()[:service_account] not in [nil, ""] or decoder() != __MODULE__

  @doc "Decode with Google, then check. Returns `:ok` or `{:error, reason}`."
  def verify(token, request_hash, now_ms \\ System.system_time(:millisecond))

  def verify(token, request_hash, now_ms) when is_binary(token) and byte_size(token) < 16_384 do
    with true <- enabled?() || {:error, :disabled},
         {:ok, payload} <- decoder().decode(token, package()) do
      check(payload, request_hash, now_ms, cfg())
    end
  end

  def verify(_, _, _), do: {:error, :malformed}

  @doc "Pure verdict check on Google's `tokenPayloadExternal`."
  def check(payload, request_hash, now_ms, cfg \\ []) do
    req = payload["requestDetails"] || %{}
    app = payload["appIntegrity"] || %{}
    dev = get_in(payload, ["deviceIntegrity", "deviceRecognitionVerdict"]) || []
    pkg = cfg[:package] || "app.thirstr"
    certs = cfg[:cert_digests] || []
    ts = to_int(req["timestampMillis"])

    with :ok <- ok(req["requestHash"] == request_hash, :request_hash),
         :ok <- ok(req["requestPackageName"] == pkg and app["packageName"] == pkg, :package),
         :ok <- ok(app_ok?(app["appRecognitionVerdict"], cfg), :app),
         :ok <-
           ok(Enum.any?(dev, &(&1 in ~w(MEETS_DEVICE_INTEGRITY MEETS_STRONG_INTEGRITY))), :device),
         :ok <- ok(is_integer(ts) and abs(now_ms - ts) <= @max_age_ms, :stale) do
      ok(
        certs == [] or Enum.any?(app["certificateSha256Digest"] || [], &(&1 in certs)),
        :certificate
      )
    end
  end

  defp ok(true, _), do: :ok
  defp ok(_, reason), do: {:error, reason}

  defp app_ok?("PLAY_RECOGNIZED", _), do: true
  defp app_ok?("UNRECOGNIZED_VERSION", cfg), do: cfg[:allow_unrecognized] == true
  defp app_ok?(_, _), do: false

  defp to_int(n) when is_integer(n), do: n

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp to_int(_), do: nil

  # ------------------------------------------------------------------ Google decode (default)

  @doc false
  def decode(token, package) do
    with {:ok, sa} <- Jason.decode(cfg()[:service_account] || ""),
         {:ok, access} <- access_token(sa) do
      case Req.post("https://playintegrity.googleapis.com/v1/#{package}:decodeIntegrityToken",
             json: %{integrity_token: token},
             auth: {:bearer, access},
             retry: false,
             receive_timeout: 10_000
           ) do
        {:ok, %{status: 200, body: %{"tokenPayloadExternal" => p}}} -> {:ok, p}
        {:ok, %{status: s}} when s in 400..499 -> {:error, :rejected}
        _ -> {:error, :unavailable}
      end
    else
      _ -> {:error, :unavailable}
    end
  end

  # OAuth2 access token from the service account (JWT bearer grant), cached 50 min.
  defp access_token(%{"private_key" => pem, "client_email" => email}) do
    now = System.system_time(:second)

    case :persistent_term.get({__MODULE__, :token}, nil) do
      {tok, at} when now - at < 3000 ->
        {:ok, tok}

      _ ->
        {_, assertion} =
          JOSE.JWT.sign(JOSE.JWK.from_pem(pem), %{"alg" => "RS256"}, %{
            "iss" => email,
            "scope" => @scope,
            "aud" => "https://oauth2.googleapis.com/token",
            "iat" => now,
            "exp" => now + 3600
          })
          |> JOSE.JWS.compact()

        case Req.post("https://oauth2.googleapis.com/token",
               form: [
                 grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                 assertion: assertion
               ],
               retry: false
             ) do
          {:ok, %{status: 200, body: %{"access_token" => tok}}} ->
            :persistent_term.put({__MODULE__, :token}, {tok, now})
            {:ok, tok}

          _ ->
            :error
        end
    end
  end

  defp access_token(_), do: :error

  defp cfg, do: Application.get_env(:thirstr, :play_integrity, [])
  defp package, do: cfg()[:package] || "app.thirstr"
  # Tests swap the Google call for a stub module with `decode/2`.
  defp decoder, do: Application.get_env(:thirstr, :play_integrity_decoder, __MODULE__)
end
