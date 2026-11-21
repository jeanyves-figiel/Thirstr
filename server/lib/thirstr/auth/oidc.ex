defmodule Thirstr.Auth.OIDC do
  @moduledoc """
  Sign in with Apple / Google (F-01 R-01.2). We verify the ID token and keep only
  HMAC(provider‖sub, pepper). Email and name claims are ignored, never stored.
  """
  alias Thirstr.Ids

  @issuers %{
    "apple" =>
      {["https://appleid.apple.com"], "https://appleid.apple.com/auth/keys", :apple_client_ids},
    # Google signs ID tokens with either issuer spelling.
    "google" =>
      {["https://accounts.google.com", "accounts.google.com"],
       "https://www.googleapis.com/oauth2/v3/certs", :google_client_ids}
  }

  @dev_issuer "https://dev-oidc.thirstr.invalid"

  def subject_hash(provider, sub), do: Ids.hash("oidc:" <> provider, sub)

  @doc "Returns {:ok, subject_hash} for a valid token."
  def verify(provider, id_token) when is_binary(provider) and is_binary(id_token) do
    with {:ok, claims} <- verify_token(provider, id_token),
         sub when is_binary(sub) <- claims["sub"] do
      {:ok, subject_hash(provider, sub)}
    else
      _ -> {:error, :unauthorized}
    end
  end

  def verify(_, _), do: {:error, :validation}

  defp verify_token(provider, token) do
    cond do
      dev_issuer?() and peek_iss(token) == @dev_issuer ->
        verify_with(token, [dev_jwk()], [@dev_issuer], ["thirstr-dev"])

      Map.has_key?(@issuers, provider) ->
        verify_remote(provider, token)

      true ->
        {:error, :unknown_provider}
    end
  end

  defp verify_remote(provider, token) do
    {issuers, jwks_url, aud_key} = @issuers[provider]
    auds = Application.fetch_env!(:thirstr, :oidc)[aud_key]

    with {:ok, %{status: 200, body: %{"keys" => keys}}} <-
           Req.get(jwks_url, retry: false, receive_timeout: 3000) do
      verify_with(token, Enum.map(keys, &JOSE.JWK.from_map/1), issuers, auds)
    end
  end

  defp verify_with(token, jwks, issuers, auds) do
    Enum.find_value(jwks, {:error, :bad_signature}, fn jwk ->
      case JOSE.JWT.verify_strict(jwk, ["RS256", "ES256"], token) do
        {true, %JOSE.JWT{fields: claims}, _} -> check_claims(claims, issuers, auds)
        _ -> nil
      end
    end)
  end

  defp check_claims(%{"iss" => iss, "aud" => aud, "exp" => exp} = claims, issuers, auds) do
    if iss in issuers and aud in auds and exp > System.system_time(:second),
      do: {:ok, claims},
      else: {:error, :invalid_claims}
  end

  defp check_claims(_, _, _), do: {:error, :invalid_claims}

  defp peek_iss(token) do
    %JOSE.JWT{fields: f} = JOSE.JWT.peek_payload(token)
    f["iss"]
  rescue
    _ -> nil
  end

  # ---- dev/test issuer: lets DEV and tests exercise the OIDC path without Apple/Google.
  def dev_issuer?, do: Application.fetch_env!(:thirstr, :oidc)[:dev_issuer] == true

  def dev_jwk do
    :persistent_term.get({__MODULE__, :dev_jwk}, nil) ||
      (fn ->
         jwk = JOSE.JWK.generate_key({:ec, "P-256"})
         :persistent_term.put({__MODULE__, :dev_jwk}, jwk)
         jwk
       end).()
  end

  def dev_mint(sub) do
    claims = %{
      "iss" => @dev_issuer,
      "aud" => "thirstr-dev",
      "sub" => sub,
      "exp" => System.system_time(:second) + 300
    }

    {_, token} = JOSE.JWT.sign(dev_jwk(), %{"alg" => "ES256"}, claims) |> JOSE.JWS.compact()
    token
  end
end
