defmodule Thirstr.Groups do
  @moduledoc """
  Membership of group chats (F-10 guest chat, F-11 activity and club chats). The server only
  checks that sender and recipient belong to the same group; content stays E2EE (MLS).
  Context strings: "party:<id>", "activity:<id>", "club:<id>".
  """
  alias Thirstr.Repo

  @doc "Profile ids in a group context, or [] when the context is unknown."
  def members("party:" <> id), do: q(:party, id)
  def members("activity:" <> id), do: q(:activity, id)
  def members("club:" <> id), do: q(:club, id)
  def members(_), do: []

  def together?(nil, _, _), do: false

  def together?(ctx, a, b) when is_binary(ctx) do
    m = members(ctx)
    a in m and b in m
  end

  def together?(_, _, _), do: false

  # sobelow_skip ["SQL.Query"]
  defp q(kind, id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.query!(sql(kind), [Ecto.UUID.dump!(id)]).rows |> List.flatten()
      _ -> []
    end
  end

  # Party: host, co-host, accepted guests; chat stays 24 h after the end (R-10.7).
  defp sql(:party),
    do: """
    SELECT unnest(ARRAY[host_profile_id, cohost_profile_id])::text FROM parties
    WHERE id = $1 AND status <> 'cancelled' AND ends_at > now() - interval '24 hours'
    UNION SELECT r.profile_id::text FROM party_requests r JOIN parties p ON p.id = r.party_id
    WHERE r.party_id = $1 AND r.state = 'accepted' AND p.ends_at > now() - interval '24 hours'
    """

  defp sql(:activity),
    do: """
    SELECT profile_id::text FROM activity_posts WHERE id = $1
    UNION SELECT profile_id::text FROM activity_rsvps WHERE post_id = $1 AND state = 'joined'
    """

  defp sql(:club),
    do: "SELECT profile_id::text FROM club_members WHERE club_id = $1 AND state = 'member'"
end
