defmodule Thirstr.AdminEnrol do
  @moduledoc """
  One-time console passkey enrolment links (admin-console.md R-AD.16). Created only over
  `fly ssh … rpc`; Valkey keeps the token's HMAC → account id for 10 min, single use.
  """
  alias Thirstr.{Ids, Valkey}

  @ttl 600

  @doc "Prints nothing; returns the enrolment URL for an id in ADMIN_ACCOUNT_IDS."
  def link(account_id) when is_binary(account_id) do
    if account_id in admins() do
      token = Ids.random_token(32)
      Valkey.put_term(key(token), account_id, @ttl)
      ThirstrWeb.AdminController.audit("console", "enrol_link", account_id, nil)
      {:ok, base() <> "/admin/enrol?t=" <> token}
    else
      {:error, :not_admin}
    end
  end

  @doc "True while the token is unused and unexpired (page render; does not consume)."
  def valid?(token) when is_binary(token) and token != "", do: Valkey.exists?(key(token))
  def valid?(_), do: false

  @doc "Consumes the token. Returns the account id if it is still an admin."
  def take(token) when is_binary(token) and token != "" do
    case Valkey.take_term(key(token)) do
      id when is_binary(id) -> if id in admins(), do: {:ok, id}, else: {:error, :not_admin}
      _ -> {:error, :gone}
    end
  end

  def take(_), do: {:error, :gone}

  defp key(token), do: "ae:" <> Base.encode16(Ids.hash("admin_enrol", token))
  defp admins, do: Application.get_env(:thirstr, :admin_account_ids, [])
  defp base, do: Application.fetch_env!(:thirstr, :app_url) |> String.trim_trailing("/")
end
