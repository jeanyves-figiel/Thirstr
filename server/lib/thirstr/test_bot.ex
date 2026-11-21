defmodule Thirstr.TestBot do
  @moduledoc """
  Chat test bots (testing.md › Chat test bots, #109, #200): a few automated, clearly labelled
  accounts on staging so testers can try chat, photos, albums, location modes, plans and
  parties end to end. Each bot is a normal client in `apps/testbot` holding its own MLS keys;
  the server only creates a verified, onboarded account per handle and gives it a session.
  Everything else (location, photos, Now, plans, parties) goes through the public API.

  Off unless `TESTBOT_KEY` is set, and never on in production.
  """
  import Ecto.Query
  alias Thirstr.{Accounts, Repo}
  alias Thirstr.Accounts.{Account, Device}
  alias Thirstr.Profiles.{Fields, Profile}

  @max_bots 12
  @handle ~r/\A[a-z0-9_]{2,20}\z/
  @bio_prefix "TEST ACCOUNT · automated bot, not a real person."

  def enabled? do
    key = Application.get_env(:thirstr, :testbot_key)
    prod? = System.get_env("DEPLOY_ENV") in ~w(prod production)
    is_binary(key) and byte_size(key) >= 24 and not prod?
  end

  @doc "Constant-time check of the bot service key."
  def key_ok?(given) when is_binary(given) do
    enabled?() and Plug.Crypto.secure_compare(given, Application.get_env(:thirstr, :testbot_key))
  end

  def key_ok?(_), do: false

  @doc """
  Creates or updates the bot `handle` from its persona (name, age, gender, here_for, show_in,
  fields, settings, seeded, server_location). Returns `{:ok, {account, profile}}`.
  """
  def ensure(persona) when is_map(persona) do
    handle = persona["handle"] || "testbot"

    cond do
      not is_binary(handle) or not Regex.match?(@handle, handle) ->
        {:error, {:validation, %{handle: ["a-z, 0-9, _ (2–20)"]}}}

      is_nil(find(handle)) and count() >= @max_bots ->
        {:error, {:validation, %{handle: ["max #{@max_bots} bots"]}}}

      true ->
        {a, p} = find(handle) || create!(handle)
        {:ok, apply!(a, p, persona)}
    end
  end

  defp find(handle) do
    case Repo.one(from(a in Account, where: a.test_bot_handle == ^handle, limit: 1)) do
      nil -> nil
      a -> {a, Repo.one!(from(p in Profile, where: p.account_id == ^a.id, limit: 1))}
    end
  end

  defp count, do: Repo.aggregate(from(a in Account, where: a.test_bot), :count)

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
          test_bot: true,
          test_bot_handle: handle,
          settings: %{}
        })

      p =
        Repo.insert!(%Profile{
          account_id: a.id,
          kind: "now",
          display_name: "Testbot 🤖",
          age: 30,
          gender: "man",
          public_updated_at: now
        })

      {a, p}
    end)
    |> elem(1)
  end

  defp apply!(a, p, persona) do
    now = DateTime.utc_now()
    lenses = pick(persona["show_in"], Profile.lenses(), Profile.lenses())
    settings = Map.merge(%{"hide_from_unverified" => false}, clean_settings(persona["settings"]))

    Repo.update_all(from(x in Account, where: x.id == ^a.id),
      set: [
        status: "active",
        verified_at: a.verified_at || now,
        incognito: false,
        settings: Map.merge(a.settings || %{}, settings)
      ]
    )

    Repo.update_all(from(x in Profile, where: x.id == ^p.id),
      set: [
        display_name: name(persona["name"]),
        age: age(persona["age"]),
        gender: pick1(persona["gender"], Profile.genders(), "man"),
        here_for: pick(persona["here_for"], Profile.here_for_values(), ~w(hookup tonight chat)),
        show_in: lenses,
        seeded: persona["seeded"] == true,
        fields: fields(persona["fields"]),
        public_updated_at: now
      ]
    )

    case persona["server_location"] do
      %{"lat" => lat, "lng" => lng} when is_number(lat) and is_number(lng) ->
        server_location!(p.id, lat, lng)

      _ ->
        :ok
    end

    Thirstr.Profiles.refresh_photo_ids(p.id)
    {Repo.get!(Account, a.id), Repo.get!(Profile, p.id)}
  end

  # The bio always says it is a test account, whatever the persona asks for.
  defp fields(f) when is_map(f) do
    bio = String.slice(@bio_prefix <> " " <> to_string(f["bio"] || ""), 0, 300) |> String.trim()
    langs = pick(f["languages"], Fields.options().languages, ["en"])

    f
    |> Map.take(~w(build height_cm position hosting looking_for tribes orientation sports
                    sport_level relationship))
    |> Map.merge(%{"bio" => bio, "languages" => langs})
  end

  defp fields(_), do: fields(%{})

  defp clean_settings(s) when is_map(s), do: Map.take(s, ~w(read_receipts hide_from_unverified))
  defp clean_settings(_), do: %{}

  defp name(n) when is_binary(n) and n != "", do: String.slice(n, 0, Profile.name_max())
  defp name(_), do: "Testbot 🤖"

  defp age(n) when is_integer(n) and n in 18..80, do: n
  defp age(_), do: 30

  defp pick(list, allowed, default) when is_list(list) do
    case Enum.filter(list, &(&1 in allowed)) do
      [] -> default
      l -> l
    end
  end

  defp pick(_, _, default), do: default

  defp pick1(v, allowed, default), do: if(v in allowed, do: v, else: default)

  # Legacy Testbot (seeded, no photos): its area cell is kept by the server.
  defp server_location!(profile_id, lat, lng) do
    Repo.query!(
      """
      INSERT INTO location_cells (profile_id, level, cell_r9, cell_r8, cell_r7, cell_r5, updated_at)
      SELECT $1, 'area',
             h3_lat_lng_to_cell(point($3::float8, $2::float8), 9)::bigint,
             h3_lat_lng_to_cell(point($3::float8, $2::float8), 8)::bigint,
             h3_lat_lng_to_cell(point($3::float8, $2::float8), 7)::bigint,
             h3_lat_lng_to_cell(point($3::float8, $2::float8), 5)::bigint, now()
      ON CONFLICT (profile_id) DO UPDATE SET level = 'area', cell_r9 = EXCLUDED.cell_r9,
        cell_r8 = EXCLUDED.cell_r8, cell_r7 = EXCLUDED.cell_r7, cell_r5 = EXCLUDED.cell_r5,
        updated_at = now()
      """,
      [Ecto.UUID.dump!(profile_id), lat, lng]
    )
  end

  @doc """
  Applies the persona, then:
  - `"new_session" => false`: nothing else (bot restart with its tokens);
  - `"resume" => true`: new tokens for the bot's latest device (its refresh token was lost),
    so the device, its queue and its chats are kept;
  - otherwise a new session. Earlier devices of that bot are removed first (their key packages
    and queued ciphertext go with them), so peers never claim keys nobody holds.
  """
  def session(persona) when is_map(persona) do
    with {:ok, {a, p}} <- ensure(persona) do
      cond do
        persona["new_session"] == false -> {:ok, %{profile_id: p.id}}
        persona["resume"] == true -> resume(a, p)
        true -> fresh(a, p)
      end
    end
  end

  defp resume(a, p) do
    latest =
      from(d in Device, where: d.account_id == ^a.id, order_by: [desc: d.inserted_at], limit: 1)

    case Repo.one(latest) do
      %Device{} = d ->
        {:ok, tokens} = Accounts.reissue_tokens(a, d)
        {:ok, Map.put(tokens, :profile_id, p.id)}

      nil ->
        fresh(a, p)
    end
  end

  defp fresh(a, p) do
    Repo.delete_all(from(d in Device, where: d.account_id == ^a.id))
    {:ok, tokens} = Accounts.start_session(a, "web")
    {:ok, Map.put(tokens, :profile_id, p.id)}
  end
end
