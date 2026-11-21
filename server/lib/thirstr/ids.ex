defmodule Thirstr.Ids do
  @moduledoc """
  Peppered one-way hashes for identifiers (R-01.2, R-01.3).
  The server never stores provider subjects, emails or IPs in clear.
  """

  def hash(kind, value) when is_binary(value) do
    :crypto.mac(:hmac, :sha256, pepper(), [kind, 0, value])
  end

  def normalize_email(email), do: email |> String.trim() |> String.downcase()

  def random_token(bytes \\ 32),
    do: :crypto.strong_rand_bytes(bytes) |> Base.url_encode64(padding: false)

  def ip_hash(conn) do
    ip = conn.remote_ip |> :inet.ntoa() |> to_string()
    # Rotates daily: IP hashes are only comparable within 24 h (security.md).
    day = Date.utc_today() |> Date.to_iso8601()
    hash("ip:" <> day, ip) |> Base.url_encode64(padding: false) |> binary_part(0, 22)
  end

  defp pepper, do: Application.fetch_env!(:thirstr, :pepper)
end
