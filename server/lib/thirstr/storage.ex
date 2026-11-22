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

  @doc "Object bytes for server-side checks (hash match, F-15 R-15.42). Public images are ≤ 15 MB."
  def get(key), do: adapter().get(key)

  @doc "Server-side write (evidence store, F-15 R-15.47)."
  def put(key, body, content_type), do: adapter().put(key, body, content_type)

  def s3_put(key, body, content_type) do
    case ExAws.S3.put_object(bucket(), key, body, content_type: content_type)
         |> ExAws.request() do
      {:ok, _} -> :ok
      e -> e
    end
  end

  def s3_get(key) do
    case ExAws.S3.get_object(bucket(), key) |> ExAws.request() do
      {:ok, %{body: body}} -> {:ok, body}
      _ -> {:error, :not_found}
    end
  end

  @doc "Total bytes in the bucket (cost page, R-AD.18). Lists keys only, never reads objects."
  def bucket_bytes, do: adapter().bucket_bytes()

  def s3_bucket_bytes do
    bytes =
      ExAws.S3.list_objects_v2(bucket(), max_keys: 1000)
      |> ExAws.stream!()
      |> Enum.reduce(0, fn o, acc -> acc + to_int(o[:size]) end)

    {:ok, bytes}
  rescue
    e -> {:error, e}
  end

  defp to_int(n) when is_integer(n), do: n
  defp to_int(s) when is_binary(s), do: String.to_integer(s)
  defp to_int(_), do: 0

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
  def get(key), do: Thirstr.Storage.s3_get(key)
  def put(key, body, ct), do: Thirstr.Storage.s3_put(key, body, ct)
  def delete_many(keys), do: Thirstr.Storage.s3_delete_many(keys)
  def bucket_bytes, do: Thirstr.Storage.s3_bucket_bytes()
end

defmodule Thirstr.Storage.Fake do
  @moduledoc "Test adapter: every object exists with a small size."
  def head(_key), do: {:ok, %{size: 1234}}
  # Written objects are kept in memory; anything else reads as "fake:<key>" so tests can
  # blocklist one exact "image".
  def get(key) do
    case :ets.whereis(__MODULE__) != :undefined && :ets.lookup(__MODULE__, key) do
      [{_, body}] -> {:ok, body}
      _ -> {:ok, "fake:" <> key}
    end
  end

  def put(key, body, _ct) do
    if :ets.whereis(__MODULE__) == :undefined,
      do: :ets.new(__MODULE__, [:named_table, :public, :set])

    :ets.insert(__MODULE__, {key, body})
    :ok
  end

  def delete_many(_keys), do: :ok
  def bucket_bytes, do: {:ok, Application.get_env(:thirstr, :fake_bucket_bytes, 2_500_000_000)}
end
