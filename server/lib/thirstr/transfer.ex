defmodule Thirstr.Transfer do
  @moduledoc """
  F-01 R-01.14 (#146) chat history to a new phone, right after a device link (R-01.6).

  The old phone seals chunks with a key both phones derived from one-time X25519 keys exchanged
  during the link (6-digit code compared on both screens), uploads each to `blob/xfer/<id>/<n>`
  and marks it ready; the new phone lists ready chunks, downloads, commits, then acks (we delete
  the object at once). We only relay ciphertext. One transfer per account at a time; ≤ 20 GiB;
  gone 2 h after its last activity.
  """
  import Ecto.Query
  alias Thirstr.{DeviceLink, Repo, Storage}
  alias Thirstr.Accounts.Account
  alias Thirstr.Jobs.PurgeObjects

  @chunk_max 4_718_592
  @total_max 20 * 1024 * 1024 * 1024
  @in_flight 8
  @url_ttl 900
  @idle_s 7200

  @doc "Old phone: start a transfer to the device the link `code` created."
  def create(%Account{id: aid} = a, from_device, %{"link_code" => code} = p) do
    est = p["estimate_bytes"]

    with true <-
           (is_integer(est) and est >= 0 and est <= @total_max) ||
             {:error, {:validation, %{estimate_bytes: ["0 – 20 GiB"]}}},
         {:ok, to} <- linked(a, code),
         true <- to != from_device || {:error, {:validation, %{link_code: ["same device"]}}} do
      cancel_all(aid)
      id = Ecto.UUID.generate()
      now = DateTime.utc_now()

      Repo.insert_all("device_transfers", [
        %{
          id: dump(id),
          account_id: dump(aid),
          from_device: dump(from_device),
          to_device: dump(to),
          estimate: est,
          updated_at: now,
          created_at: now
        }
      ])

      {:ok, %{id: id, to_device: to}}
    end
  end

  def create(_, _, _), do: {:error, {:validation, %{link_code: ["required"]}}}

  defp linked(a, code) do
    case DeviceLink.linked_device(a, code) do
      {:ok, d} ->
        {:ok, d}

      {:error, :not_ready} ->
        {:error, {:conflict_code, "not_ready", "The new phone isn't signed in yet"}}

      e ->
        e
    end
  end

  @doc "Old phone: upload slot for chunk `n`."
  def chunk(%Account{} = a, dev, id, %{"n" => n, "size" => size}) do
    with {:ok, t} <- mine(a, id, :from, dev),
         true <- t.state == "sending" || {:error, :not_found},
         true <-
           (is_integer(n) and n >= 0 and is_integer(size) and size > 0 and size <= @chunk_max) ||
             {:error, {:validation, %{size: ["1 B – 4.5 MiB"]}}},
         true <- t.bytes + size <= @total_max || {:error, {:unprocessable, "quota", "Too much"}},
         true <-
           t.sent - t.acked < @in_flight || {:error, {:conflict_code, "busy", "Wait for acks"}} do
      Repo.query!(
        """
        INSERT INTO device_transfer_chunks (transfer_id, n, size) VALUES ($1, $2, $3)
        ON CONFLICT (transfer_id, n) DO UPDATE SET size = $3, ready = false
        """,
        [dump(id), n, size]
      )

      {:ok, url} = Storage.presigned_put(key(id, n), "application/octet-stream")
      {:ok, %{upload_url: url}}
    end
  end

  def chunk(_, _, _, _), do: {:error, {:validation, %{n: ["required"], size: ["required"]}}}

  @doc "Old phone: chunk `n` is uploaded (checked in storage); the new phone may fetch it."
  def ready(%Account{} = a, dev, id, n) do
    with {:ok, _} <- mine(a, id, :from, dev),
         {n, ""} <- Integer.parse(to_string(n)),
         %{rows: [[size, false]]} <-
           Repo.query!(
             "SELECT size, ready FROM device_transfer_chunks WHERE transfer_id = $1 AND n = $2",
             [dump(id), n]
           ),
         {:ok, %{size: ^size}} <- Storage.head(key(id, n)) do
      Repo.query!(
        "UPDATE device_transfer_chunks SET ready = true WHERE transfer_id = $1 AND n = $2",
        [dump(id), n]
      )

      Repo.query!(
        "UPDATE device_transfers SET sent = sent + 1, bytes = bytes + $2, updated_at = now() WHERE id = $1",
        [dump(id), size]
      )

      :ok
    else
      %{rows: [[_, true]]} -> :ok
      {:error, _} = e -> e
      _ -> {:error, {:conflict_code, "chunk_missing", "Upload the chunk first"}}
    end
  end

  @doc "Old phone: everything is sent (`total` chunks)."
  def finish(%Account{} = a, dev, id, %{"total" => total}) when is_integer(total) do
    with {:ok, _} <- mine(a, id, :from, dev) do
      Repo.query!(
        """
        UPDATE device_transfers SET total = $2, updated_at = now(),
          state = CASE WHEN acked >= $2 THEN 'done' ELSE state END
        WHERE id = $1
        """,
        [dump(id), total]
      )

      :ok
    end
  end

  def finish(_, _, _, _), do: {:error, {:validation, %{total: ["required"]}}}

  @doc "New phone: the transfer addressed to this device, with the chunks ready to fetch."
  def incoming(%Account{id: aid}, dev) do
    case Repo.one(
           from(t in "device_transfers",
             where:
               t.account_id == ^dump(aid) and t.to_device == ^dump(dev) and
                 t.state == "sending",
             order_by: [desc: t.created_at],
             limit: 1,
             select: t.id
           )
         ) do
      nil -> {:error, :not_found}
      id -> {:ok, view(load(id), true)}
    end
  end

  @doc "Either phone: progress (the old phone uses `acked` to pace uploads)."
  def get(%Account{} = a, dev, id) do
    with {:ok, t} <- mine(a, id, :either, dev), do: {:ok, view(id, t.to_device == dev)}
  end

  @doc "New phone: chunks committed to its store; their objects go now."
  def ack(%Account{} = a, dev, id, %{"n" => ns}) when is_list(ns) do
    with {:ok, _} <- mine(a, id, :to, dev),
         true <- Enum.all?(ns, &is_integer/1) || {:error, {:validation, %{n: ["integers"]}}} do
      %{num_rows: k} =
        Repo.query!(
          "DELETE FROM device_transfer_chunks WHERE transfer_id = $1 AND n = ANY($2) AND ready",
          [dump(id), ns]
        )

      Repo.query!(
        """
        UPDATE device_transfers
        SET acked = acked + $2, updated_at = now(),
            state = CASE WHEN total IS NOT NULL AND acked + $2 >= total THEN 'done' ELSE state END
        WHERE id = $1
        """,
        [dump(id), k]
      )

      purge(Enum.map(ns, &key(id, &1)))
      :ok
    end
  end

  def ack(_, _, _, _), do: {:error, {:validation, %{n: ["required"]}}}

  @doc "Either phone: cancel; every chunk goes."
  def cancel(%Account{} = a, dev, id) do
    with {:ok, _} <- mine(a, id, :either, dev) do
      drop([dump(id)])
      :ok
    end
  end

  @doc "Transfers idle for 2 h (and finished ones) go with their chunks."
  def sweep do
    %{rows: ids} =
      Repo.query!(
        "SELECT id FROM device_transfers WHERE updated_at < now() - make_interval(secs => $1) OR state <> 'sending'",
        [@idle_s]
      )

    drop(Enum.map(ids, &hd/1))
    :ok
  end

  @doc "Object keys of an account's transfers (account delete)."
  def keys_of(account_id) do
    from(c in "device_transfer_chunks",
      join: t in "device_transfers",
      on: t.id == c.transfer_id,
      where: t.account_id == ^dump(account_id),
      select: {t.id, c.n}
    )
    |> Repo.all()
    |> Enum.map(fn {id, n} -> key(load(id), n) end)
  end

  # ---------------------------------------------------------------- helpers

  defp view(id, receiver?) do
    t = row(id)

    chunks =
      if receiver? do
        from(c in "device_transfer_chunks",
          where: c.transfer_id == ^dump(id) and c.ready,
          order_by: c.n,
          select: {c.n, c.size}
        )
        |> Repo.all()
        |> Enum.map(fn {n, size} ->
          %{n: n, size: size, url: Storage.presigned_get(key(id, n), @url_ttl)}
        end)
      end

    %{
      id: id,
      state: t.state,
      estimate: t.estimate,
      bytes: t.bytes,
      sent: t.sent,
      acked: t.acked,
      total: t.total
    }
    |> then(&if(chunks, do: Map.put(&1, :chunks, chunks), else: &1))
  end

  defp mine(%Account{id: aid}, id, side, dev) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{account_id: a} = t <- row(id),
         true <- a == aid,
         true <-
           (case side do
              :from -> t.from_device == dev
              :to -> t.to_device == dev
              :either -> dev in [t.from_device, t.to_device]
            end) do
      {:ok, t}
    else
      _ -> {:error, :not_found}
    end
  end

  defp row(id) do
    case Repo.query!(
           """
           SELECT account_id, from_device, to_device, state, estimate, bytes, sent, acked, total
           FROM device_transfers WHERE id = $1
           """,
           [dump(id)]
         ) do
      %{rows: [[a, f, t, st, est, b, s, ack, tot]]} ->
        %{
          account_id: load(a),
          from_device: load(f),
          to_device: load(t),
          state: st,
          estimate: est,
          bytes: b,
          sent: s,
          acked: ack,
          total: tot
        }

      _ ->
        nil
    end
  end

  defp cancel_all(aid) do
    %{rows: ids} =
      Repo.query!("SELECT id FROM device_transfers WHERE account_id = $1", [dump(aid)])

    drop(Enum.map(ids, &hd/1))
  end

  defp drop([]), do: :ok

  defp drop(bin_ids) do
    keys =
      from(c in "device_transfer_chunks",
        where: c.transfer_id in ^bin_ids,
        select: {c.transfer_id, c.n}
      )
      |> Repo.all()
      |> Enum.map(fn {id, n} -> key(load(id), n) end)

    Repo.query!("DELETE FROM device_transfers WHERE id = ANY($1)", [bin_ids])
    purge(keys)
  end

  defp purge([]), do: :ok
  defp purge(keys), do: %{"keys" => keys} |> PurgeObjects.new() |> Oban.insert()

  defp key(id, n), do: "blob/xfer/#{id}/#{n}"
  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
  defp load(bin), do: Ecto.UUID.load!(bin)
end
