defmodule ThirstrWeb.FallbackController do
  @moduledoc "Maps context errors to the api.md error envelope."
  use ThirstrWeb, :controller

  def call(conn, {:error, reason}), do: error(conn, reason)

  def error(conn, :unauthorized), do: send_error(conn, 401, "unauthorized", "Sign in again")

  def error(conn, :recovery_invalid),
    do: send_error(conn, 401, "recovery_invalid", "These words don't match an account")

  def error(conn, :forbidden), do: send_error(conn, 403, "forbidden", "Not allowed")
  def error(conn, {:forbidden, msg}), do: send_error(conn, 403, "forbidden", msg)
  def error(conn, :not_found), do: send_error(conn, 404, "not_found", "Not found")
  def error(conn, :conflict), do: send_error(conn, 409, "conflict", "Already exists")

  def error(conn, :refresh_race),
    do: send_error(conn, 409, "refresh_race", "Refresh already in progress")

  def error(conn, {:conflict, msg}), do: send_error(conn, 409, "conflict", msg)

  def error(conn, :too_many_devices),
    do:
      send_error(
        conn,
        409,
        "conflict",
        "You can use Thirstr on up to 5 devices. Remove one in Account & data."
      )

  def error(conn, :age_confirmation_required),
    do:
      send_error(conn, 422, "validation", "Confirm you are 18 or older", %{
        age_confirmed: ["must be accepted"]
      })

  # R-12.11 duplicate guard: offer the place that is already listed.
  def error(conn, {:place_exists, existing}) do
    conn
    |> put_status(409)
    |> json(%{
      error: %{
        code: "place_exists",
        message: "This place is already on Thirstr",
        existing: existing
      }
    })
  end

  def error(conn, {:conflict_code, code, msg}), do: send_error(conn, 409, code, msg)
  def error(conn, {:unprocessable, code, msg}), do: send_error(conn, 422, code, msg)
  def error(conn, {:unavailable, msg}), do: send_error(conn, 409, "unavailable", msg)
  def error(conn, {:not_verified, msg}), do: send_error(conn, 403, "not_verified", msg)
  def error(conn, {:safe_mode_blocked, msg}), do: send_error(conn, 403, "safe_mode_blocked", msg)

  def error(conn, {:rate_limited, retry}) do
    conn
    |> put_resp_header("retry-after", Integer.to_string(retry))
    |> put_status(429)
    |> json(%{error: %{code: "rate_limited", message: "Slow down", retry_after: retry}})
  end

  def error(conn, :underage), do: send_error(conn, 403, "underage", "You need to be 18+")
  def error(conn, :underage_blocked), do: send_error(conn, 403, "underage", "You need to be 18+")
  def error(conn, :basics_required), do: send_error(conn, 409, "conflict", "Finish Basics first")

  def error(conn, {:validation, fields}),
    do: send_error(conn, 422, "validation", "Check the highlighted fields", fields)

  def error(conn, :validation), do: send_error(conn, 422, "validation", "Invalid request")

  def error(conn, %Ecto.Changeset{} = cs),
    do: error(conn, {:validation, Thirstr.Onboarding.errors(cs)})

  def error(conn, _), do: send_error(conn, 500, "internal", "Something went wrong")

  defp send_error(conn, status, code, message, fields \\ nil) do
    body = %{code: code, message: message}
    body = if fields, do: Map.put(body, :fields, fields), else: body
    conn |> put_status(status) |> json(%{error: body})
  end
end
