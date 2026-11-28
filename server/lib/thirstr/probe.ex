defmodule Thirstr.Probe do
  @moduledoc """
  EN-23 OB-2 (#343, docs/spec/delivery-latency-monitoring.md): synthetic end-to-end chat probe.

  Two hidden accounts per environment (`probe_a`, `probe_b`, `accounts.probe = true`) that a
  runner outside Fly (GitHub Actions, every 5 min) uses as two real MLS clients: A sends one
  encrypted nonce to B, B receives it on the socket, acks and replies; B's second device pulls
  over REST; a repeat with the same `client_id` must be caught. The runner then reports step
  times here, and they become `thirstr_probe_*` metrics.

  - Off unless `PROBE_KEY` (≥ 32 bytes) is set. Allowed in prod (unlike Testbot).
  - Probe accounts can only message each other: nobody else can claim their key packages and
    they can't claim anyone else's (`Thirstr.Chat`). No location, no lenses: never in Explore.
  - Each run starts fresh devices (earlier devices, keys and queued ciphertext are removed), so
    no MLS state lives between runs.
  """
  import Ecto.Query
  alias Thirstr.{Accounts, Repo}
  alias Thirstr.Accounts.{Account, Device}
  alias Thirstr.Profiles.Profile

  @handles ~w(probe_a probe_b)
  @steps ~w(send socket ack reply pull duplicate total)

  def enabled? do
    key = Application.get_env(:thirstr, :probe_key)
    is_binary(key) and byte_size(key) >= 32
  end

  def key_ok?(given) when is_binary(given),
    do:
      enabled?() and Plug.Crypto.secure_compare(given, Application.get_env(:thirstr, :probe_key))

  def key_ok?(_), do: false

  def steps, do: @steps

  @doc "Fresh session for `probe_a` / `probe_b`. `devices: 2` adds a second (offline) device."
  def session(%{"handle" => handle} = params) when handle in @handles do
    {a, p} = find(handle) || create!(handle)
    Repo.delete_all(from(d in Device, where: d.account_id == ^a.id))
    n = if params["devices"] == 2, do: 2, else: 1

    sessions =
      for _ <- 1..n do
        {:ok, t} = Accounts.start_session(a, "web")
        Map.take(t, [:access_token, :refresh_token, :expires_in, :device_id])
      end

    {:ok, %{profile_id: p.id, sessions: sessions}}
  end

  def session(_), do: {:error, {:validation, %{handle: ["probe_a or probe_b"]}}}

  @doc "Is this account a probe? (cheap: the struct carries the flag)."
  def probe?(%Account{probe: true}), do: true
  def probe?(_), do: false

  @doc "Profile ids belong to probe accounts? Used once per new chat (key package claim)."
  def probe_profile?(pid) do
    Repo.exists?(
      from(p in Profile,
        join: a in Account,
        on: a.id == p.account_id,
        where: p.id == ^pid and a.probe
      )
    )
  end

  @doc """
  Runner report: `%{"ok" => bool, "steps" => %{step => ms | nil}, "failed" => step | nil}`.
  Emits `[:thirstr, :probe, :run]` (result) and `[:thirstr, :probe, :step]` (duration).
  """
  def report(%{"ok" => ok} = r) when is_boolean(ok) do
    steps = if is_map(r["steps"]), do: r["steps"], else: %{}

    for {step, ms} <- steps, step in @steps, is_number(ms), ms >= 0 do
      :telemetry.execute([:thirstr, :probe, :step], %{duration_ms: ms}, %{step: step})
    end

    failed = if r["failed"] in @steps, do: r["failed"], else: if(ok, do: "none", else: "other")
    result = if ok, do: "ok", else: "fail"
    :telemetry.execute([:thirstr, :probe, :run], %{count: 1}, %{result: result, failed: failed})

    Thirstr.Health.put_probe(%{
      "ok" => ok,
      "failed" => if(ok, do: nil, else: failed),
      "steps" => Map.new(for {k, v} <- steps, k in @steps, do: {k, if(is_number(v), do: v)})
    })

    :ok
  end

  def report(_), do: {:error, {:validation, %{ok: ["must be true or false"]}}}

  defp find(handle) do
    case Repo.one(from(a in Account, where: a.probe and a.test_bot_handle == ^handle, limit: 1)) do
      nil -> nil
      a -> {a, Repo.one!(from(p in Profile, where: p.account_id == ^a.id, limit: 1))}
    end
  end

  defp create!(handle) do
    now = DateTime.utc_now()

    Repo.transaction(fn ->
      a =
        Repo.insert!(%Account{
          status: "active",
          safe_mode: "off",
          onboarding_step: "done",
          birthdate: Date.add(Date.utc_today(), -30 * 365),
          age_confirmed_at: now,
          verified_at: now,
          probe: true,
          test_bot_handle: handle,
          settings: %{"read_receipts" => false, "push" => %{}}
        })

      p =
        Repo.insert!(%Profile{
          account_id: a.id,
          kind: "now",
          display_name: "Probe",
          age: 30,
          gender: "man",
          show_in: [],
          public_updated_at: now
        })

      {a, p}
    end)
    |> elem(1)
  end
end
