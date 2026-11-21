defmodule ThirstrWeb.ChatController do
  @moduledoc "F-07 MLS delivery service, F-08 encrypted blobs, F-16 push token (api.md › Messaging)."
  use ThirstrWeb, :controller
  alias Thirstr.{Chat, Push}

  action_fallback ThirstrWeb.FallbackController

  defp a(conn), do: conn.assigns.account
  defp d(conn), do: conn.assigns.device_id

  def upload_key_packages(conn, params) do
    with {:ok, counts} <- Chat.upload_key_packages(a(conn), d(conn), params),
         do: json(conn, %{counts: counts, device_id: d(conn)})
  end

  def key_package_counts(conn, _),
    do: json(conn, %{counts: Chat.key_package_counts(a(conn), d(conn)), device_id: d(conn)})

  def claim_key_packages(conn, %{"from_profile_id" => from, "to_profile_id" => to} = p) do
    with {:ok, kps} <- Chat.claim_key_packages(a(conn), from, to, p["context"]),
         do: json(conn, %{key_packages: kps})
  end

  def claim_key_packages(_, _),
    do: {:error, {:validation, %{to_profile_id: ["can't be blank"]}}}

  def send_messages(conn, params) do
    with {:ok, res} <- Chat.send(a(conn), d(conn), params), do: json(conn, res)
  end

  def pull(conn, params) do
    after_id =
      case Integer.parse(to_string(params["after"] || "0")) do
        {i, _} -> i
        _ -> 0
      end

    json(conn, %{
      messages: Chat.pull(a(conn), d(conn), after_id),
      expired: Chat.take_expired(d(conn))
    })
  end

  def ack(conn, params) do
    with {:ok, n} <- Chat.ack(a(conn), d(conn), params["ids"]), do: json(conn, %{deleted: n})
  end

  def create_blob(conn, params) do
    with {:ok, res} <- Chat.create_blob(a(conn), params),
         do: conn |> put_status(201) |> json(res)
  end

  def blob(conn, %{"id" => id}) do
    with {:ok, res} <- Chat.blob_url(a(conn), id), do: json(conn, res)
  end

  def delete_blob(conn, %{"id" => id}) do
    with :ok <- Chat.delete_blob(a(conn), id), do: send_resp(conn, 204, "")
  end

  def push_token(conn, params) do
    with :ok <- Push.register(d(conn), params["token"], params["platform"]),
         do: send_resp(conn, 204, "")
  end
end
