defmodule ThirstrWeb.ClientErrorsTest do
  # EN-05 (#164): reports are scrubbed, grouped, unlinked from accounts; counted for crash-free rate.
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.{ClientErrors, Repo}

  test "same crash twice = one group with count 2; personal data scrubbed", %{conn: conn} do
    body = %{
      platform: "ios",
      build: "141",
      fatal: true,
      message:
        "TypeError at https://api.thirstr.fun/v1/me?x=1 for max@example.com id 3f2b1c4e-1111-2222-3333-444455556666 tok eyJhbGciOiJFUzI1NiJ9abcdefghijklmnop 4155550123",
      stack: "at ChatScreen (index.bundle:1:2345)\nat render"
    }

    conn |> post("/v1/client/errors", body) |> response(204)
    build_conn() |> post("/v1/client/errors", body) |> response(204)

    [[n, msg, fatal]] = Repo.query!("SELECT count, message, fatal FROM client_errors").rows
    assert n == 2 and fatal
    refute msg =~ "example.com"
    refute msg =~ "3f2b1c4e"
    refute msg =~ "eyJhbGci"
    refute msg =~ "4155550123"
    refute msg =~ "api.thirstr.fun"

    cols =
      Repo.query!(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'client_errors'"
      ).rows
      |> List.flatten()

    refute Enum.any?(cols, &(&1 =~ ~r/account|device|install|ip/))
  end

  test "validation and session ping", %{conn: conn} do
    conn |> post("/v1/client/errors", %{platform: "x", message: "m"}) |> json_response(422)
    build_conn() |> post("/v1/client/sessions", %{platform: "android"}) |> response(204)
  end

  test "sweep drops groups not seen for 30 days" do
    ClientErrors.record(%{"platform" => "web", "message" => "old"})
    Repo.query!("UPDATE client_errors SET last_seen = now() - interval '31 days'")
    ClientErrors.sweep()
    assert Repo.query!("SELECT count(*) FROM client_errors").rows == [[0]]
  end
end
