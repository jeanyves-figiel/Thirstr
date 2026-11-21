defmodule Thirstr.Storage do
  @moduledoc "S3-compatible object storage (MinIO in DEV, Tigris EU on Fly). Presigned URLs only."
  @put_ttl 300
  # SR-10 (#150): GET URLs are signed from the start of a 6 h window and valid 12 h, so the same
  # photo gets the same URL all window long and the phone's image cache actually hits (a fresh
  # signature per response meant every grid open re-downloaded every photo).
  @get_window 6 * 3600
  @get_ttl 12 * 3600

  def presigned_put(key, content_type) do
    ExAws.S3.presigned_url(public_cfg(), :put, bucket(), key,
      expires_in: @put_ttl,
      headers: [{"content-type", content_type}]
    )
  end

  def presigned_get(key) do
    {:ok, url} =
      ExAws.S3.presigned_url(public_cfg(), :get, bucket(), key,
        expires_in: @get_ttl,
        start_datetime: window_start()
      )

    url
  end

  @doc "Short-lived GET from now, not cache-windowed: video check one-time blobs (R-18.12)."
  def presigned_get(key, ttl) when is_integer(ttl) do
    {:ok, url} = ExAws.S3.presigned_url(public_cfg(), :get, bucket(), key, expires_in: ttl)
    url
  end

  defp window_start do
    now = System.system_time(:second)

    (now - rem(now, @get_window))
    |> DateTime.from_unix!()
    |> DateTime.to_naive()
  end

  @doc "GET URL for server-side services (classifier) reaching storage on the private network."
  def internal_presigned_get(key) do
    {:ok, url} =
      ExAws.S3.presigned_url(ExAws.Config.new(:s3), :get, bucket(), key, expires_in: 120)

    url
  end

  def head(key), do: adapter().head(key)

  def s3_head(key) do
    case ExAws.S3.head_object(bucket(), key) |> ExAws.request() do
      {:ok, %{headers: headers}} -> {:ok, %{size: content_length(headers)}}
      _ -> {:error, :not_found}
    end
  end

  defp content_length(headers) do
    Enum.find_value(headers, 0, fn {k, v} ->
      if String.downcase(k) == "content-length", do: String.to_integer(v)
    end)
  end

  def delete_many([]), do: :ok
  def delete_many(keys), do: adapter().delete_many(keys)

  def s3_delete_many(keys) do
    keys
    |> Enum.chunk_every(1000)
    |> Enum.each(&(ExAws.S3.delete_multiple_objects(bucket(), &1) |> ExAws.request()))

    :ok
  end

  def ensure_bucket do
    ExAws.S3.put_bucket(bucket(), cfg()[:region]) |> ExAws.request()
  end

  defp public_cfg do
    uri = URI.parse(cfg()[:public_endpoint])
    ExAws.Config.new(:s3, scheme: "#{uri.scheme}://", host: uri.host, port: uri.port)
  end

  defp adapter, do: Application.get_env(:thirstr, :storage_adapter, __MODULE__.S3)
  defp bucket, do: cfg()[:bucket]
  defp cfg, do: Application.fetch_env!(:thirstr, :storage)
end

defmodule Thirstr.Storage.S3 do
  @moduledoc false
  def head(key), do: Thirstr.Storage.s3_head(key)
  def delete_many(keys), do: Thirstr.Storage.s3_delete_many(keys)
end

defmodule Thirstr.Storage.Fake do
  @moduledoc "Test adapter: every object exists with a small size."
  def head(_key), do: {:ok, %{size: 1234}}
  def delete_many(_keys), do: :ok
end
