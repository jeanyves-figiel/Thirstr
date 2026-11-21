defmodule Thirstr.WebPush do
  @moduledoc """
  Empty-payload Web Push with VAPID (RFC 8292) for trusted contacts (F-13 › Web Push). No payload
  means no content is ever handed to the push service; the contact page fetches and decrypts.
  The ES256 key is generated once and kept in `server_keys` (`vapid`).
  """
  alias Thirstr.Repo

  @hosts ~w(fcm.googleapis.com push.services.mozilla.com push.apple.com notify.windows.com)

  @doc "Only real browser push services (no SSRF to arbitrary hosts)."
  def allowed?(endpoint) do
    case URI.parse(endpoint) do
      %URI{scheme: "https", host: host, port: 443} when is_binary(host) ->
        Enum.any?(@hosts, &(host == &1 or String.ends_with?(host, "." <> &1)))

      _ ->
        false
    end
  end

  def public_key do
    %{"x" => x, "y" => y} = jwk() |> JOSE.JWK.to_public_map() |> elem(1)
    Base.url_encode64(<<4>> <> b64(x) <> b64(y), padding: false)
  end

  @doc "Fire-and-forget wake of one subscription; 404/410 forgets it."
  def send(%{"endpoint" => ep}) do
    case Application.get_env(:thirstr, :webpush_sink) do
      pid when is_pid(pid) -> Kernel.send(pid, {:webpush, ep})
      _ -> Task.start(fn -> post(ep) end)
    end

    :ok
  end

  def send(_), do: :ok

  defp post(ep) do
    if allowed?(ep) do
      %URI{scheme: s, host: h} = URI.parse(ep)

      {_, jwt} =
        JOSE.JWT.sign(jwk(), %{"alg" => "ES256", "typ" => "JWT"}, %{
          "aud" => "#{s}://#{h}",
          "exp" => System.system_time(:second) + 12 * 3600,
          "sub" => "mailto:hello@thirstr.fun"
        })
        |> JOSE.JWS.compact()

      Req.post(ep,
        body: "",
        headers: [
          {"authorization", "vapid t=#{jwt}, k=#{public_key()}"},
          {"ttl", "86400"},
          {"urgency", "high"}
        ],
        retry: false,
        receive_timeout: 10_000
      )
      |> case do
        {:ok, %{status: st}} when st in [404, 410] ->
          Repo.query!("UPDATE safety_relays SET push = NULL WHERE push->>'endpoint' = $1", [ep])

        r ->
          r
      end
    end
  end

  defp jwk do
    case :persistent_term.get({__MODULE__, :jwk}, nil) do
      nil ->
        k = load_or_create()
        :persistent_term.put({__MODULE__, :jwk}, k)
        k

      k ->
        k
    end
  end

  defp load_or_create do
    case Repo.query!("SELECT der FROM server_keys WHERE name = 'vapid'").rows do
      [[pem]] ->
        JOSE.JWK.from_pem(pem)

      [] ->
        {_, pem} = JOSE.JWK.generate_key({:ec, "P-256"}) |> JOSE.JWK.to_pem()

        Repo.query!(
          "INSERT INTO server_keys (name, der, created_at) VALUES ('vapid', $1, now()) ON CONFLICT DO NOTHING",
          [pem]
        )

        [[pem]] = Repo.query!("SELECT der FROM server_keys WHERE name = 'vapid'").rows
        JOSE.JWK.from_pem(pem)
    end
  end

  defp b64(s), do: Base.url_decode64!(s, padding: false)
end
