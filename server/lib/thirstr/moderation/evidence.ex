defmodule Thirstr.Moderation.Evidence do
  @moduledoc """
  F-15 R-15.47 (#287): evidence store for CSAM cases. The matched image is sealed with a fresh
  AES-256-GCM data key, stored under `evidence/<case id>` (never presigned, never served), and the
  data key is kept on the case wrapped by the evidence key (`EVIDENCE_KEY`, 32 bytes base64; until
  it is set, derived from the app secret). Only the console's reasoned, audited view opens it.
  Deleted 1 year after the case unless a legal hold extends `hold_until` (`sweep/0`).
  """
  alias Thirstr.{Repo, Storage}

  @aad "thirstr-evidence-v1"

  @doc "Seals `bytes` for case `id`. Returns {evidence_key, wrapped_dek}."
  def seal(id, bytes) do
    dek = :crypto.strong_rand_bytes(32)
    key = "evidence/" <> id
    :ok = Storage.put(key, encrypt(dek, bytes), "application/octet-stream")
    {key, encrypt(master(), dek)}
  end

  @doc "Opens a sealed case image."
  def open(key, wrapped) do
    with {:ok, blob} <- Storage.get(key),
         {:ok, dek} <- decrypt(master(), wrapped) do
      decrypt(dek, blob)
    end
  end

  defp encrypt(k, plain) do
    iv = :crypto.strong_rand_bytes(12)
    {ct, tag} = :crypto.crypto_one_time_aead(:aes_256_gcm, k, iv, plain, @aad, true)
    iv <> tag <> ct
  end

  defp decrypt(k, <<iv::binary-12, tag::binary-16, ct::binary>>) do
    case :crypto.crypto_one_time_aead(:aes_256_gcm, k, iv, ct, @aad, tag, false) do
      :error -> {:error, :bad_seal}
      plain -> {:ok, plain}
    end
  end

  defp decrypt(_, _), do: {:error, :bad_seal}

  defp master do
    case Application.get_env(:thirstr, :evidence_key) do
      k when is_binary(k) and byte_size(k) > 0 ->
        Base.decode64!(k)

      _ ->
        base = Application.fetch_env!(:thirstr, ThirstrWeb.Endpoint)[:secret_key_base]
        :crypto.mac(:hmac, :sha256, base, "thirstr evidence key v1")
    end
  end

  @doc "Retention (R-15.47): evidence past `hold_until` of decided cases is deleted; the case row stays for counts."
  def sweep do
    rows =
      Repo.query!("""
      SELECT id, evidence_key FROM csam_cases
      WHERE evidence_key IS NOT NULL AND hold_until < now() AND state <> 'open' LIMIT 500
      """).rows

    Storage.delete_many(Enum.map(rows, fn [_, k] -> k end))

    Enum.each(rows, fn [id, _] ->
      Repo.query!(
        "UPDATE csam_cases SET evidence_key = NULL, evidence_dek = NULL, evidence_deleted_at = now() WHERE id = $1",
        [id]
      )
    end)
  end
end
