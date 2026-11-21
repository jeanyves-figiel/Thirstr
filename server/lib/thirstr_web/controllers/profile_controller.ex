defmodule ThirstrWeb.ProfileController do
  @moduledoc "F-06 own profiles (S-60, S-62) and others' profiles (S-20, S-21)."
  use ThirstrWeb, :controller

  alias Thirstr.{Profiles, Social}
  alias Thirstr.Profiles.Fields
  alias ThirstrWeb.MeJSON

  action_fallback ThirstrWeb.FallbackController

  def options(conn, _),
    do:
      json(conn, %{
        options: Fields.options(),
        defaults:
          Map.new(Fields.catalogue(), fn {k, {_, v, kinds}} ->
            {k, %{visibility: v, kinds: kinds, lenses: lenses(kinds)}}
          end),
        health: Fields.health()
      })

  # F-06 R-06.1b: lenses that show a field.
  defp lenses(:all), do: Fields.lenses()

  defp lenses(kinds) do
    ["hookup"] ++
      if("friends" in kinds, do: ["friends", "sport"], else: []) ++
      if("sport" in kinds and "friends" not in kinds, do: ["sport"], else: [])
  end

  # --- own

  def index(conn, _),
    do: json(conn, %{profiles: Enum.map(Profiles.list_own(a(conn)), &MeJSON.profile/1)})

  def update(conn, %{"id" => id} = params) do
    with {:ok, p} <- Profiles.update(a(conn), id, params), do: json(conn, MeJSON.profile(p))
  end

  def create_photo(conn, %{"profile_id" => pid} = params) do
    ct = params["content_type"] || "image/jpeg"

    with {:ok, photo, put_url, thumb_url} <-
           Profiles.create_photo_upload(a(conn), pid, params["slot"] || 0, ct) do
      conn
      |> put_status(201)
      |> json(%{photo_id: photo.id, put_url: put_url, thumb_put_url: thumb_url, content_type: ct})
    end
  end

  def check_photo(conn, %{"profile_id" => pid, "photo_id" => id}) do
    with {:ok, photo, _p} <- Profiles.check_photo(a(conn), pid, id) do
      account =
        if photo.slot == 0 and photo.status == "ok_main" do
          {:ok, acc, _} = advance_onboarding(conn, pid, id)
          acc
        else
          a(conn)
        end

      json(conn, %{photo: MeJSON.photo(photo), account: MeJSON.me(account)})
    end
  end

  # Onboarding step "photo" advances on the first accepted main photo of the Now profile.
  defp advance_onboarding(conn, _pid, _id) do
    acc = a(conn)

    if acc.onboarding_step == "photo" do
      acc = acc |> Ecto.Changeset.change(onboarding_step: "verify") |> Thirstr.Repo.update!()
      {:ok, acc, nil}
    else
      {:ok, acc, nil}
    end
  end

  def delete_photo(conn, %{"profile_id" => pid, "photo_id" => id}) do
    with {:ok, p} <- Profiles.delete_photo(a(conn), pid, id), do: json(conn, MeJSON.profile(p))
  end

  def order_photos(conn, %{"profile_id" => pid, "order" => ids}) do
    with {:ok, p} <- Profiles.reorder_photos(a(conn), pid, ids), do: json(conn, MeJSON.profile(p))
  end

  # --- others

  def show(conn, %{"id" => id} = params) do
    # F-20 R-20.15: `trip_id` = viewed while looking around that trip's city.
    point =
      case params["trip_id"] do
        t when is_binary(t) and t != "" -> Thirstr.Trips.point(a(conn), t)
        _ -> {:ok, nil}
      end

    with {:ok, p} <- point,
         {:ok, view} <- Social.view(a(conn), id, params["mode"], p),
         do: json(conn, view)
  end

  def tap(conn, %{"id" => id}) do
    with {:ok, res} <- Social.tap(a(conn), id), do: json(conn, res)
  end

  def block(conn, %{"id" => id}) do
    with :ok <- Social.block(a(conn), id), do: send_resp(conn, 204, "")
  end

  def unblock(conn, %{"id" => id}) do
    with :ok <- Social.unblock(a(conn), id), do: send_resp(conn, 204, "")
  end

  def blocks(conn, _), do: json(conn, %{blocks: Social.blocks(a(conn))})

  def hidden(conn, _), do: json(conn, %{hidden: Social.hidden(a(conn))})

  def hide(conn, %{"id" => id}) do
    with :ok <- Social.hide(a(conn), id), do: send_resp(conn, 204, "")
  end

  def unhide(conn, %{"id" => id}) do
    with :ok <- Social.unhide(a(conn), id), do: send_resp(conn, 204, "")
  end

  def taps(conn, _), do: json(conn, %{taps: Social.taps(a(conn))})

  def taps_seen(conn, _) do
    Social.mark_taps_seen(a(conn))
    send_resp(conn, 204, "")
  end

  defp a(conn), do: conn.assigns.account
end
