defmodule Thirstr.ClientErrors do
  @moduledoc """
  EN-05 (#164): crash and error reports from the apps, kept on our own EU servers (no vendor).

  Privacy: reports carry no account, device or install id. Message and stack are scrubbed
  (emails, URLs, ids, long numbers, base64) and cut to size before storage, then grouped by a
  signature so one bug is one row with a count. Rows are deleted 30 days after last seen.
  Crash-free sessions = 1 − fatal / sessions (both Prometheus counters, monitoring.md).
  """
  alias Thirstr.Repo

  @platforms ~w(ios android web)
  @max_msg 300
  @max_stack 4000

  def record(params) when is_map(params) do
    platform = params["platform"]
    msg = params["message"]

    if platform in @platforms and is_binary(msg) and msg != "" do
      fatal = params["fatal"] == true
      build = Thirstr.Flags.parse_build(params["build"])
      msg = msg |> scrub() |> String.slice(0, @max_msg)

      stack =
        if is_binary(params["stack"]),
          do: params["stack"] |> scrub() |> String.slice(0, @max_stack)

      sig = signature(platform, build, msg, stack)

      Repo.query!(
        """
        INSERT INTO client_errors (signature, platform, build, fatal, message, stack)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (signature) DO UPDATE SET count = client_errors.count + 1, last_seen = now(),
          fatal = client_errors.fatal OR EXCLUDED.fatal
        """,
        [sig, platform, build, fatal, msg, stack]
      )

      :telemetry.execute([:thirstr, :client, :error], %{count: 1}, %{
        platform: platform,
        fatal: fatal
      })

      :ok
    else
      {:error, {:validation, %{message: ["required"], platform: ["ios, android or web"]}}}
    end
  end

  @doc "One app session started (crash-free rate denominator). Counter only, nothing stored."
  def session(platform) when platform in @platforms do
    :telemetry.execute([:thirstr, :client, :session], %{count: 1}, %{platform: platform})
    :ok
  end

  def session(_), do: {:error, {:validation, %{platform: ["ios, android or web"]}}}

  @doc "Newest groups first (ops / admin)."
  def recent(limit \\ 50) do
    Repo.query!(
      "SELECT platform, build, fatal, count, message, last_seen FROM client_errors ORDER BY last_seen DESC LIMIT $1",
      [limit]
    ).rows
  end

  def sweep,
    do: Repo.query!("DELETE FROM client_errors WHERE last_seen < now() - interval '30 days'")

  @doc "Removes anything that could identify a person or a secret."
  def scrub(s) do
    s
    |> String.replace(~r/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "<email>")
    |> String.replace(~r/https?:\/\/[^\s)"']+/, "<url>")
    |> String.replace(
      ~r/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
      "<id>"
    )
    |> String.replace(~r/\b(?:Bearer\s+)?[A-Za-z0-9_\-]{24,}={0,2}/, "<token>")
    |> String.replace(~r/[A-Za-z0-9+\/]{24,}={0,2}/, "<b64>")
    |> String.replace(~r/\d{6,}/, "<n>")
  end

  defp signature(platform, build, msg, stack) do
    frames = (stack || "") |> String.split("\n") |> Enum.take(5) |> Enum.join("\n")
    norm = String.replace(msg, ~r/\d+/, "#")

    :crypto.hash(:sha256, Enum.join([platform, build, norm, frames], "\u0000"))
    |> Base.encode16(case: :lower)
  end
end
