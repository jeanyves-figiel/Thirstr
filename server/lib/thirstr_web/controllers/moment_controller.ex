defmodule ThirstrWeb.MomentController do
  @moduledoc "F-21 Moments (#212): temporary photos (S-76 composer, S-77 viewer)."
  use ThirstrWeb, :controller

  alias Thirstr.{Moments, Social}

  action_fallback ThirstrWeb.FallbackController

  def upload(conn, params) do
    with {:ok, _} <- Social.limit(conn.assigns.account, "moment_up", 40, 3600),
         {:ok, res} <- Moments.create_upload(conn.assigns.account, params["content_type"]) do
      conn |> put_status(201) |> json(res)
    end
  end

  def publish(conn, %{"id" => id} = params) do
    with {:ok, m} <- Moments.publish(conn.assigns.account, id, Map.delete(params, "id")),
         do: json(conn, m)
  end

  def mine(conn, _), do: json(conn, %{moments: Moments.mine(conn.assigns.account)})

  def delete(conn, %{"id" => id}) do
    with :ok <- Moments.delete(conn.assigns.account, id), do: send_resp(conn, 204, "")
  end

  def for_profile(conn, %{"id" => id} = params) do
    with {:ok, list} <- Moments.for_profile(conn.assigns.account, id, params["mode"]),
         do: json(conn, %{moments: list})
  end

  def views(conn, params) do
    with {:ok, _} <- Social.limit(conn.assigns.account, "moment_views", 600, 3600),
         {:ok, n} <- Moments.record_views(conn.assigns.account, params["ids"]),
         do: json(conn, %{recorded: n})
  end

  def tap(conn, %{"id" => id}) do
    with {:ok, res} <- Moments.tap(conn.assigns.account, id), do: json(conn, res)
  end

  def screenshot(conn, %{"id" => id}) do
    with {:ok, _} <- Moments.screenshot(conn.assigns.account, id), do: send_resp(conn, 204, "")
  end

  def mute(conn, %{"profile_id" => pid}) do
    with :ok <- Moments.mute(conn.assigns.account, pid, true), do: send_resp(conn, 204, "")
  end

  def unmute(conn, %{"profile_id" => pid}) do
    with :ok <- Moments.mute(conn.assigns.account, pid, false), do: send_resp(conn, 204, "")
  end
end
