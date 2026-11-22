defmodule ThirstrWeb.PlusTest do
  # F-23 Thirstr Plus (#7, D-25): entitlement sources, limits on /me, Free limits enforced.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{Flags, Plus, Repo}

  setup %{conn: conn} do
    :ets.delete(:thirstr_flags, :rows)
    on_exit(fn -> :ets.delete(:thirstr_flags, :rows) end)
    {:ok, u: onboarded(conn)}
  end

  defp billing_on, do: Flags.set("plus_billing", true, %{}, "test")

  defp me(u), do: u.c |> recycle_authed() |> get("/v1/me") |> json_response(200)

  defp req(u, path, body, plus_header? \\ true) do
    c = recycle_authed(u.c)
    c = if plus_header?, do: put_req_header(c, "x-thirstr-plus", "1"), else: c
    post(c, path, body)
  end

  defp in_h(h),
    do: DateTime.utc_now() |> DateTime.add(round(h * 3600), :second) |> DateTime.to_iso8601()

  defp plan(u, header? \\ true),
    do:
      req(
        u,
        "/v1/tonight",
        %{tag: "hosting", window_start: in_h(0), window_end: in_h(2), tz_offset_min: 0},
        header?
      )

  defp party(u, cap),
    do:
      req(u, "/v1/parties", %{
        title: "Sauna night",
        starts_at: in_h(1),
        ends_at: in_h(4),
        capacity: cap,
        rules: []
      })

  @tag ac: "AC-23.1"
  test "beta: everyone has Plus and the Plus limits", %{u: u} do
    m = me(u)
    assert m["plus"] == %{"active" => true, "source" => "beta"}
    assert m["limits"]["nearby"] == nil
    assert m["limits"]["party_capacity"] == 40
    assert m["limits"]["tonight_active"] == 3
  end

  @tag ac: "AC-23.4"
  test "billing on: Free limits; Safe Mode on gives Plus at no cost", %{u: u} do
    billing_on()
    m = me(u)
    assert m["plus"] == %{"active" => false, "source" => "none"}
    assert m["limits"]["nearby"] == 200
    assert m["limits"]["trips"] == 1

    Repo.query!(
      "UPDATE accounts SET safe_mode = 'on' WHERE id = (SELECT account_id FROM profiles WHERE id = $1)",
      [
        Ecto.UUID.dump!(u.pid)
      ]
    )

    assert %{"active" => true, "source" => "safe_mode"} = me(u)["plus"]
  end

  test "billing on: a grant is Plus until it ends", %{u: u} do
    billing_on()
    a = account_of(u.pid)

    Repo.query!(
      """
      INSERT INTO plus_entitlements (id, account_id, store, product, state, period_end, granted_by, reason, inserted_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'grant', 'plus.grant', 'active', now() + interval '1 day', 'owner', 'tester', now(), now())
      """,
      [Ecto.UUID.dump!(a.id)]
    )

    assert %{active: true, source: "grant"} = Plus.entitlement(a)
    Repo.query!("UPDATE plus_entitlements SET period_end = now() - interval '1 second'")
    assert %{active: false} = Plus.entitlement(a)
  end

  test "Free: 1 Tonight plan; new apps get plus_limit, old apps get validation", %{u: u} do
    billing_on()
    plan(u) |> json_response(201)

    assert %{
             "error" => %{
               "code" => "plus_limit",
               "limit" => "tonight_active",
               "free" => 1,
               "plus" => 3
             }
           } = plan(u) |> json_response(422)

    assert %{"error" => %{"code" => "validation", "fields" => %{"tonight_active" => [_]}}} =
             plan(u, false) |> json_response(422)
  end

  @tag ac: "AC-23.3"
  test "Free host: 10 guests, 1 party a week; Plus host: 40 guests", %{u: u} do
    billing_on()

    assert %{"error" => %{"code" => "plus_limit", "limit" => "party_capacity"}} =
             party(u, 11) |> json_response(422)

    %{"id" => id} = party(u, 10) |> json_response(201)

    u.c
    |> recycle_authed()
    |> patch("/v1/parties/#{id}", %{status: "cancelled"})
    |> json_response(200)

    assert %{"error" => %{"code" => "plus_limit", "limit" => "party_per_week", "next_at" => next}} =
             party(u, 4) |> json_response(422)

    assert next

    Flags.set("plus_billing", false, %{}, "test")
    :ets.delete(:thirstr_flags, :rows)
    assert party(u, 41) |> json_response(422)
    party(u, 40) |> json_response(201)
  end
end
