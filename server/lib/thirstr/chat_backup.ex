defmodule Thirstr.ChatBackup do
  @moduledoc """
  F-01 R-01.15 (#146) opt-in chat backup.

  The phone seals append-only segments and a manifest with a key derived from the recovery
  phrase (vault key → HKDF "thirstr-chats-v1"); we store ciphertext only. Flow: `new_segment/2`
  gives a presigned PUT per segment, `commit/2` stores the manifest and the list of live segments
  (checked against storage); segments no longer listed are deleted after 24 h so a phone that
  crashes mid-compaction still has a readable backup. Needs the recovery phrase on.
  """
  import Ecto.Query
  alias Thirstr.{Repo, Social, Storage}
  alias Thirstr.Accounts.Account
  alias Thirstr.Jobs.PurgeObjects

  @seg_max 4_718_592
  @manifest_max 262_144
  @quota 2 * 1024 * 1024 * 1024
  @url_ttl 3600
  @grace_s 24 * 3600
  # R-01.15: no upload for 180 d (+30 d after the reminder) → deleted
  @idle_d 210

  def quota, do: @quota

  def status(%Account{id: id}) do
    case Repo.query!(
           "SELECT bytes, segments, updated_at FROM chat_backups WHERE account_id = $1",
           [dump(id)]
         ) do
      %{rows: [[b, n, at]]} ->
        {:ok, %{on: true, bytes: b, segments: n, updated_at: at, quota: @quota}}

      _ ->
        {:error, :not_found}
    end
  end

  @doc "Upload slot for one sealed segment."
  def new_segment(%Account{id: id} = a, %{"size" => size, "sha256" => sha}) do
    with true <-
           (is_integer(size) and size > 0 and size <= @seg_max) ||
             {:error, {:validation, %{size: ["1 B – 4.5 MiB"]}}},
         {:ok, hash} <- unb64(sha, :sha256),
         true <-
           byte_size(hash) == 32 || {:error, {:validation, %{sha256: ["must be 32 bytes"]}}},
         true <- recovery_on?(id) || {:error, recovery_off()},
         true <-
           used(id) + size <= @quota || {:error, {:unprocessable, "quota", "Backup is full"}},
         {:ok, _} <- Social.limit(a, "bseg", 500, 86_400) do
      sid = Ecto.UUID.generate()
      key = "backup/#{id}/#{sid}"

      Repo.insert_all("chat_backup_segments", [
        %{
          id: dump(sid),
          account_id: dump(id),
          storage_key: key,
          size: size,
          sha256: hash,
          committed: false,
          created_at: DateTime.utc_now()
        }
      ])

      {:ok, put_url} = Storage.presigned_put(key, "application/octet-stream")
      {:ok, %{id: sid, upload_url: put_url}}
    end
  end

  def new_segment(_, _), do: {:error, {:validation, %{size: ["required"], sha256: ["required"]}}}

  @doc "Stores the manifest; `segments` = every live segment id, in order."
  def commit(%Account{id: id} = a, %{"manifest" => m, "segments" => ids}) when is_list(ids) do
    with {:ok, bin} <- unb64(m, :manifest),
         true <-
           byte_size(bin) <= @manifest_max ||
             {:error, {:validation, %{manifest: ["max 256 KiB"]}}},
         true <- recovery_on?(id) || {:error, recovery_off()},
         {:ok, uuids} <- cast_ids(ids),
         {:ok, rows} <- owned(id, uuids),
         :ok <- check_uploaded(rows) do
      now = DateTime.utc_now()
      bytes = rows |> Enum.map(fn {_, _, size, _} -> size end) |> Enum.sum()
      live = Enum.map(uuids, &dump/1)

      {:ok, gone} =
        Repo.transaction(fn ->
          Repo.query!(
            """
            INSERT INTO chat_backups (account_id, manifest, bytes, segments, inserted_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $5)
            ON CONFLICT (account_id) DO UPDATE
              SET manifest = $2, bytes = $3, segments = $4, updated_at = $5
            """,
            [dump(id), bin, bytes, length(uuids), now]
          )

          Repo.query!(
            "UPDATE chat_backup_segments SET committed = true WHERE id = ANY($1)",
            [live]
          )

          %{rows: gone} =
            Repo.query!(
              """
              DELETE FROM chat_backup_segments
              WHERE account_id = $1 AND committed AND NOT (id = ANY($2))
              RETURNING storage_key
              """,
              [dump(id), live]
            )

          Enum.map(gone, &hd/1)
        end)

      purge(gone, @grace_s)
      status(a)
    end
  end

  def commit(_, _),
    do: {:error, {:validation, %{manifest: ["required"], segments: ["required"]}}}

  @doc "Manifest + 1 h download URLs for each segment (restore)."
  def get(%Account{id: id}) do
    case Repo.query!(
           "SELECT manifest, updated_at FROM chat_backups WHERE account_id = $1",
           [dump(id)]
         ) do
      %{rows: [[m, at]]} ->
        {:ok, %{manifest: Base.encode64(m), updated_at: at, segments: segments(id)}}

      _ ->
        {:error, :not_found}
    end
  end

  defp segments(id) do
    from(s in "chat_backup_segments",
      where: s.account_id == ^dump(id) and s.committed,
      select: {s.id, s.size, s.storage_key}
    )
    |> Repo.all()
    |> Enum.map(fn {sid, size, key} ->
      %{id: load(sid), size: size, url: Storage.presigned_get(key, @url_ttl)}
    end)
  end

  @doc "Turn off, recovery off, new words: backup and every segment go at once."
  def delete(%Account{id: id}) do
    keys = keys_of(id)
    Repo.query!("DELETE FROM chat_backups WHERE account_id = $1", [dump(id)])
    Repo.query!("DELETE FROM chat_backup_segments WHERE account_id = $1", [dump(id)])
    purge(keys, 0)
    :ok
  end

  @doc "Object keys of an account's backup (account delete, R-01.10)."
  def keys_of(account_id) do
    from(s in "chat_backup_segments",
      where: s.account_id == ^dump(account_id),
      select: s.storage_key
    )
    |> Repo.all()
  end

  @doc "Uncommitted segments after 24 h; backups idle for #{@idle_d} d."
  def sweep do
    %{rows: stale} =
      Repo.query!("""
      DELETE FROM chat_backup_segments
      WHERE NOT committed AND created_at < now() - interval '24 hours'
      RETURNING storage_key
      """)

    %{rows: idle} =
      Repo.query!(
        "DELETE FROM chat_backups WHERE updated_at < now() - make_interval(days => $1) RETURNING account_id",
        [@idle_d]
      )

    idle_keys =
      case idle do
        [] ->
          []

        _ ->
          %{rows: k} =
            Repo.query!(
              "DELETE FROM chat_backup_segments WHERE account_id = ANY($1) RETURNING storage_key",
              [Enum.map(idle, &hd/1)]
            )

          k
      end

    purge(Enum.map(stale ++ idle_keys, &hd/1), 0)
    :ok
  end

  # ---------------------------------------------------------------- helpers

  defp used(id) do
    %{rows: [[n]]} =
      Repo.query!(
        "SELECT coalesce(sum(size), 0) FROM chat_backup_segments WHERE account_id = $1",
        [dump(id)]
      )

    n
  end

  defp recovery_on?(id),
    do: Repo.exists?(from(k in "account_recovery", where: k.account_id == ^dump(id), select: 1))

  defp recovery_off, do: {:conflict_code, "recovery_off", "Turn on the recovery phrase first"}

  defp cast_ids(ids) do
    Enum.reduce_while(ids, {:ok, []}, fn i, {:ok, acc} ->
      case Ecto.UUID.cast(i) do
        {:ok, u} -> {:cont, {:ok, [u | acc]}}
        _ -> {:halt, {:error, {:validation, %{segments: ["invalid id"]}}}}
      end
    end)
    |> case do
      {:ok, l} -> if l == Enum.uniq(l), do: {:ok, Enum.reverse(l)}, else: dup()
      e -> e
    end
  end

  defp dup, do: {:error, {:validation, %{segments: ["duplicate id"]}}}

  defp owned(id, uuids) do
    rows =
      from(s in "chat_backup_segments",
        where: s.account_id == ^dump(id) and s.id in ^Enum.map(uuids, &dump/1),
        select: {s.id, s.storage_key, s.size, s.committed}
      )
      |> Repo.all()

    if length(rows) == length(uuids),
      do: {:ok, rows},
      else: {:error, {:conflict_code, "segment_missing", "A segment is missing"}}
  end

  # New segments must be in storage with the size that was declared.
  defp check_uploaded(rows) do
    rows
    |> Enum.reject(fn {_, _, _, committed} -> committed end)
    |> Enum.all?(fn {_, key, size, _} ->
      match?({:ok, %{size: ^size}}, Storage.head(key))
    end)
    |> if(do: :ok, else: {:error, {:conflict_code, "segment_missing", "A segment is missing"}})
  end

  defp purge([], _), do: :ok

  defp purge(keys, delay) do
    %{"keys" => keys} |> PurgeObjects.new(schedule_in: delay) |> Oban.insert()
    :ok
  end

  defp unb64(v, field) when is_binary(v) do
    case Base.decode64(v) do
      {:ok, b} -> {:ok, b}
      :error -> {:error, {:validation, %{field => ["invalid base64"]}}}
    end
  end

  defp unb64(_, field), do: {:error, {:validation, %{field => ["required"]}}}

  defp dump(uuid), do: Ecto.UUID.dump!(uuid)
  defp load(bin), do: Ecto.UUID.load!(bin)
end
