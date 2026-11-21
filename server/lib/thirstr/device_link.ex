defmodule Thirstr.DeviceLink do
  @moduledoc """
  R-01.6 / R-01.8 linked devices (beta-build-plan.md › B4d).

  Old device: `start/1` → 8-char code (120 s). New device: `claim/1` with the code gets a claim
  secret; old device sees the claim and `confirm/2`s it after app lock / Face ID; the new device
  then exchanges code + claim for a session (`claim/1` again). State lives in Valkey only.
  """
  import Ecto.Query
  alias Thirstr.{Accounts, Repo, Valkey}
  alias Thirstr.Accounts.{Account, Device}

  @ttl 120
  @done_ttl 7200
  @alphabet ~c"0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  def devices(%Account{} = a, current) do
    rows =
      Repo.all(
        from(d in Device,
          where: d.account_id == ^a.id and is_nil(d.revoked_at),
          order_by: d.inserted_at,
          select: {d.id, d.platform, d.last_seen_day}
        )
      )

    %{
      devices:
        Enum.map(rows, fn {id, p, day} ->
          %{id: id, platform: p, last_seen_day: day, current: id == current}
        end)
    }
  end

  def remove(%Account{} = a, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         {1, _} <-
           Repo.delete_all(from(d in Device, where: d.id == ^id and d.account_id == ^a.id)) do
      :ok
    else
      _ -> {:error, :not_found}
    end
  end

  def start(%Account{} = a, params \\ %{}) do
    code = for _ <- 1..8, into: "", do: <<Enum.random(@alphabet)>>
    # R-01.14: one-time X25519 keys of both phones travel with the link (public halves only).
    s = %{account: a.id, state: "pending", xfer_old: pub(params["xfer_pub"])}
    Valkey.put_term(key(code), s, @ttl)
    {:ok, %{code: code, expires_in: @ttl}}
  end

  def status(%Account{} = a, code) do
    case get(code) do
      %{account: id} = s when id == a.id ->
        {:ok, %{state: s.state, platform: s[:platform], xfer_pub: s[:xfer_new]}}

      _ ->
        {:error, :not_found}
    end
  end

  def confirm(%Account{} = a, code) do
    case get(code) do
      %{account: id, state: "claimed"} = s when id == a.id ->
        put(code, %{s | state: "confirmed"})
        :ok

      _ ->
        {:error, :not_found}
    end
  end

  @doc "New device. Without `claim`: claims a pending code. With `claim`: polls, then gets a session."
  def claim(%{"code" => code, "claim" => claim}) when is_binary(code) and is_binary(claim) do
    case get(code) do
      %{state: "confirmed", claim: h, account: id} = s ->
        if Plug.Crypto.secure_compare(h, hash(claim)) do
          Valkey.command(["DEL", key(code)])

          with %Account{status: st} = a when st in ~w(active paused quarantined suspended) <-
                 Accounts.get_account(id),
               {:ok, session} <- Accounts.start_session(a, s.platform) do
            # R-01.14: the old phone addresses the history transfer to this device by link code.
            Valkey.put_term(
              "dlinkdone:" <> String.upcase(code),
              %{account: id, device: session.device_id},
              @done_ttl
            )

            {:ok, session}
          else
            {:error, _} = e -> e
            _ -> {:error, :not_found}
          end
        else
          {:error, :not_found}
        end

      %{state: "claimed", claim: h} ->
        if Plug.Crypto.secure_compare(h, hash(claim)),
          do: {:waiting, %{state: "claimed"}},
          else: {:error, :not_found}

      _ ->
        {:error, :not_found}
    end
  end

  def claim(%{"code" => code} = p) when is_binary(code) do
    case get(code) do
      %{state: "pending"} = s ->
        claim = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
        platform = if p["platform"] in Device.platforms(), do: p["platform"], else: "web"

        put(
          code,
          Map.merge(s, %{
            state: "claimed",
            claim: hash(claim),
            platform: platform,
            xfer_new: pub(p["xfer_pub"])
          })
        )

        {:waiting, %{state: "claimed", claim: claim, xfer_pub: s[:xfer_old]}}

      _ ->
        {:error, :not_found}
    end
  end

  def claim(_), do: {:error, {:validation, %{code: ["required"]}}}

  defp get(code) when is_binary(code) do
    case Valkey.command(["GET", key(code)]) do
      {:ok, bin} when is_binary(bin) -> Valkey.decode(bin)
      _ -> nil
    end
  end

  defp get(_), do: nil

  defp put(code, s) do
    case Valkey.command(["TTL", key(code)]) do
      {:ok, t} when is_integer(t) and t > 0 -> Valkey.put_term(key(code), s, t)
      _ -> :ok
    end
  end

  @doc "R-01.14: the device a confirmed link created (2 h), for the history transfer."
  def linked_device(%Account{id: aid}, code) when is_binary(code) do
    case Valkey.command(["GET", "dlinkdone:" <> String.upcase(code)]) do
      {:ok, bin} when is_binary(bin) ->
        case Valkey.decode(bin) do
          %{account: ^aid, device: d} -> {:ok, d}
          _ -> {:error, :not_found}
        end

      _ ->
        {:error, :not_ready}
    end
  end

  def linked_device(_, _), do: {:error, :not_found}

  # 32-byte X25519 public key, base64url; anything else is dropped.
  defp pub(v) when is_binary(v) and byte_size(v) <= 64 do
    case Base.url_decode64(v, padding: false) do
      {:ok, <<_::binary-32>>} -> v
      _ -> nil
    end
  end

  defp pub(_), do: nil

  defp key(code), do: "dlink:" <> String.upcase(code)
  defp hash(s), do: :crypto.hash(:sha256, s)
end
