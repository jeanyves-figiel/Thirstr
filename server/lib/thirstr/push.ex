defmodule Thirstr.Push do
  @moduledoc """
  F-16 content-free pushes (AC-16.1). The payload never carries names, text or images: a fixed
  generic alert plus an opaque token; the app fetches and renders details locally (R-16.1).
  Per-type toggles and quiet hours are applied here because the server knows only the event
  type (R-16.2, R-16.4). Safe Mode uses the neutral "Reminder" wording (R-16.3).
  """
  alias Thirstr.{Repo, Settings, Valkey}
  alias Thirstr.Accounts.Account

  # event => {settings toggle, bypasses quiet hours?}
  @types %{
    "message.new" => {"message", false},
    "tap.new" => {"tap", false},
    "tap.mutual" => {"mutual", false},
    "party.request" => {"party_request", false},
    "party.accepted" => {"party_accepted", false},
    "party.status" => {"party_accepted", false},
    "activity.join" => {"activity_join", false},
    "club.request" => {"club_event", false},
    "checkin.due" => {"checkin", true},
    "checkin.alert" => {"checkin_alert", true}
  }

  def types, do: @types

  def register(device_id, token, platform) do
    cond do
      platform not in ~w(ios android) ->
        {:error, {:validation, %{platform: ["ios or android"]}}}

      not (is_binary(token) and Regex.match?(~r/^[0-9a-fA-F]{32,200}$/, token)) ->
        {:error, {:validation, %{token: ["invalid"]}}}

      true ->
        Repo.query!(
          "UPDATE devices SET push_token = $1, push_platform = $2 WHERE id = $3",
          [String.downcase(token), platform, Ecto.UUID.dump!(device_id)]
        )

        :ok
    end
  end

  @doc """
  Called by Notify for every event; throttled to one wake per account per 20 s (R-16.5).
  If Valkey is unreachable the job is still queued; Oban's uniqueness keeps the throttle (SR-11).
  """
  def maybe_wake(account_id, event) do
    case Map.get(@types, event) do
      nil ->
        :ok

      _ ->
        if throttle_free?(account_id) do
          %{account_id: account_id, event: event}
          |> Thirstr.Jobs.PushWake.new()
          |> Oban.insert()
        end

        :ok
    end
  end

  defp throttle_free?(account_id) do
    case Valkey.safe(["SET", "pushq:" <> account_id, "1", "NX", "EX", "20"]) do
      {:ok, "OK"} -> true
      {:ok, _} -> false
      {:error, _} -> true
    end
  end

  @doc """
  Sends the wake to every device of the account with a token, unless toggled off.
  Returns `{:error, :retry}` when a send failed in a way a retry can fix (APNs/FCM 429, 5xx,
  network), so the Oban job retries with backoff (SR-02). Unknown platforms are skipped.
  """
  def deliver(account_id, event) do
    with %Account{} = a <- Repo.get(Account, account_id),
         true <- wanted?(a, event) do
      safe = Account.safe_mode_on?(a)

      Repo.query!(
        "SELECT push_token, push_platform FROM devices WHERE account_id = $1 AND push_token IS NOT NULL AND revoked_at IS NULL",
        [Ecto.UUID.dump!(account_id)]
      ).rows
      |> Enum.map(fn [token, platform] -> send_one(platform, token, safe) end)
      |> Enum.any?(&(&1 == :retry))
      |> if(do: {:error, :retry}, else: :ok)
    else
      _ -> :ok
    end
  end

  defp send_one(platform, token, safe) do
    outcome =
      case platform do
        "ios" -> send_apns(token, payload(safe))
        "android" -> send_fcm(token, fcm_message(token, safe))
        _ -> :skipped
      end

    :telemetry.execute([:thirstr, :push, :send], %{count: 1}, %{
      platform: platform,
      outcome: outcome
    })

    outcome
  end

  defp wanted?(a, event) do
    {toggle, urgent} = Map.fetch!(@types, event)
    s = Settings.get(a)

    Map.get(s["push"] || %{}, toggle, true) and (urgent or not quiet?(s["quiet_hours"]))
  end

  defp quiet?(%{"from" => f, "to" => t, "tz_offset_min" => o}) do
    h = DateTime.utc_now() |> DateTime.add(o * 60, :second) |> Map.get(:hour)
    if f <= t, do: h >= f and h < t, else: h >= f or h < t
  end

  defp quiet?(_), do: false

  @doc "The only payload shape the server sends (api.md › Push payloads)."
  def payload(safe_mode?) do
    {title, body} =
      if safe_mode?, do: {"Reminder", "You have a reminder"}, else: {"Thirstr", "New activity"}

    %{
      "aps" => %{
        "alert" => %{"title" => title, "body" => body},
        "sound" => "default",
        "mutable-content" => 1
      },
      "t" => Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)
    }
  end

  defp send_apns(token, payload) do
    cfg = Application.get_env(:thirstr, :apns, [])

    cond do
      cfg[:mock_url] ->
        Req.post(cfg[:mock_url], [json: payload, retry: false] ++ req_opts()) |> outcome()

      cfg[:key_p8] && cfg[:key_id] && cfg[:team_id] ->
        Req.post("#{cfg[:host]}/3/device/#{token}",
          json: payload,
          headers: [
            {"authorization", "bearer " <> jwt(cfg)},
            {"apns-topic", cfg[:topic]},
            {"apns-push-type", "alert"},
            {"apns-priority", "10"},
            {"apns-collapse-id", "thirstr"}
          ],
          connect_options: [protocols: [:http2]],
          receive_timeout: 10_000,
          retry: false
        )
        |> handle_apns(token)

      true ->
        :skipped
    end
  end

  # 410 Unregistered / 400 BadDeviceToken → forget the token. 403 = provider token rejected:
  # mint a new one on the retry.
  defp handle_apns({:ok, %{status: s}}, token) when s in [400, 410] do
    Repo.query!("UPDATE devices SET push_token = NULL WHERE push_token = $1", [token])
    :ok
  end

  defp handle_apns({:ok, %{status: 403}}, _token) do
    :persistent_term.erase({__MODULE__, :jwt})
    :retry
  end

  defp handle_apns(res, _), do: outcome(res)

  # Tests route requests through Req.Test (config :thirstr, :push_req).
  defp req_opts, do: Application.get_env(:thirstr, :push_req, [])

  @doc false
  def outcome({:ok, %{status: s}}) when s in 200..299, do: :ok
  def outcome({:ok, %{status: s}}) when s == 429 or s >= 500, do: :retry
  def outcome({:ok, _}), do: :ok
  def outcome({:error, _}), do: :retry

  # ---------------------------------------------------------------- FCM (Android, HTTP v1)

  @doc "FCM message: same content-free wording as APNs (AC-16.1); `t` is an opaque token."
  def fcm_message(token, safe_mode?) do
    {title, body} =
      if safe_mode?, do: {"Reminder", "You have a reminder"}, else: {"Thirstr", "New activity"}

    %{
      "message" => %{
        "token" => token,
        "notification" => %{"title" => title, "body" => body},
        "android" => %{"priority" => "high", "collapse_key" => "thirstr"},
        "data" => %{"t" => Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)}
      }
    }
  end

  defp send_fcm(token, msg) do
    cfg = Application.get_env(:thirstr, :fcm, [])

    cond do
      cfg[:mock_url] ->
        Req.post(cfg[:mock_url], [json: msg, retry: false] ++ req_opts()) |> outcome()

      sa = cfg[:service_account] && Jason.decode!(cfg[:service_account]) ->
        case fcm_token(sa) do
          {:ok, bearer} ->
            Req.post(
              "https://fcm.googleapis.com/v1/projects/#{sa["project_id"]}/messages:send",
              json: msg,
              headers: [{"authorization", "Bearer " <> bearer}],
              receive_timeout: 10_000,
              retry: false
            )
            |> handle_fcm(token)

          _ ->
            :retry
        end

      true ->
        :skipped
    end
  end

  # 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token → forget it.
  defp handle_fcm({:ok, %{status: 404}}, token), do: forget(token)

  defp handle_fcm({:ok, %{status: 400, body: %{"error" => %{"details" => d}}}} = res, token) do
    if Enum.any?(List.wrap(d), &(&1["errorCode"] in ["UNREGISTERED", "INVALID_ARGUMENT"])),
      do: forget(token),
      else: outcome(res)
  end

  defp handle_fcm(res, _), do: outcome(res)

  defp forget(token) do
    Repo.query!("UPDATE devices SET push_token = NULL WHERE push_token = $1", [token])
    :ok
  end

  # OAuth2 access token from the service account (JWT bearer grant), cached 50 min.
  defp fcm_token(sa) do
    now = System.system_time(:second)

    case :persistent_term.get({__MODULE__, :fcm}, nil) do
      {tok, at} when now - at < 3000 ->
        {:ok, tok}

      _ ->
        jwk = JOSE.JWK.from_pem(sa["private_key"])

        {_, assertion} =
          JOSE.JWT.sign(jwk, %{"alg" => "RS256"}, %{
            "iss" => sa["client_email"],
            "scope" => "https://www.googleapis.com/auth/firebase.messaging",
            "aud" => "https://oauth2.googleapis.com/token",
            "iat" => now,
            "exp" => now + 3600
          })
          |> JOSE.JWS.compact()

        case Req.post("https://oauth2.googleapis.com/token",
               form: [
                 grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                 assertion: assertion
               ],
               retry: false
             ) do
          {:ok, %{status: 200, body: %{"access_token" => tok}}} ->
            :persistent_term.put({__MODULE__, :fcm}, {tok, now})
            {:ok, tok}

          _ ->
            :error
        end
    end
  end

  # Provider token, reused for 40 min (Apple: refresh between 20 and 60 min).
  defp jwt(cfg) do
    now = System.system_time(:second)

    case :persistent_term.get({__MODULE__, :jwt}, nil) do
      {tok, at} when now - at < 2400 ->
        tok

      _ ->
        jwk = JOSE.JWK.from_pem(String.replace(cfg[:key_p8], "\\n", "\n"))

        {_, tok} =
          JOSE.JWT.sign(jwk, %{"alg" => "ES256", "kid" => cfg[:key_id]}, %{
            "iss" => cfg[:team_id],
            "iat" => now
          })
          |> JOSE.JWS.compact()

        :persistent_term.put({__MODULE__, :jwt}, {tok, now})
        tok
    end
  end
end
