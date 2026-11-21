defmodule Thirstr.Profiles.Fields do
  @moduledoc """
  F-06 field catalogue (concept/profile-and-settings.md §1) and per-field visibility (R-06.4).

  The server stores only values whose visibility is `public` or `verified`. Values set to
  `chats` / `only_me` are kept on the device and sent E2EE to chat partners (R-06.6), so the
  API drops them. Health fields can never be `public` (R-06.5, AC-06.2).
  """

  @orientations ~w(gay bi queer pan curious other)
  @builds ~w(slim fit muscular average stocky large)
  @hair ~w(none light moderate hairy very)
  @beards ~w(none stubble short full)
  @tribes ~w(bear twink jock otter daddy geek leather pup rugged trans clean_cut chub muscle discreet)
  @looking_for ~w(hookup now tonight chat dates friends activities)
  @positions ~w(top vers_top vers vers_bottom bottom side)
  @practices ~w(oral kissing cuddling massage kink bdsm fetish group watching rimming fisting toys roleplay safer_only)
  @hosting ~w(can_host can_travel either neither)
  @prep ~w(on off doxypep ask)
  @hiv ~w(neg pos_undetectable pos ask)
  @sports ~w(gym running cycling swimming climbing football basketball volleyball tennis padel yoga crossfit hiking skiing martial_arts dance rugby rowing other)
  @levels ~w(beginner casual intermediate advanced competitive)
  @schedule ~w(mornings lunch evenings weekends)
  @intents ~w(just_sport open_to_more)
  @relationship ~w(single partnered open poly complicated)
  @prompts ~w(perfect_night ask_me_about green_flag weekend looking_for_someone_who)
  @languages ~w(en fr de it es pt nl pl tr ru ar he ja zh id th hi sv da no fi cs el hu ro uk)

  # key => {type, opts}; default visibility; lenses that show it besides Hookup (F-06 R-06.1b):
  # :all = every lens, "friends" = Friends and Sport, "sport" = Sport only, "now" = Hookup only.
  @catalogue %{
    "pronouns" => {{:text, 20}, "public", :all},
    "orientation" => {{:enum, @orientations}, "public", :all},
    "languages" => {{:multi, @languages, 6}, "public", :all},
    "bio" => {{:text, 300}, "public", :all},
    "prompt_q" => {{:enum, @prompts}, "public", :all},
    "prompt_a" => {{:text, 150}, "public", :all},
    "height_cm" => {{:int, 120, 230}, "public", :all},
    "weight_kg" => {{:int, 40, 250}, "public", ~w(now friends)},
    "build" => {{:enum, @builds}, "public", :all},
    "body_hair" => {{:enum, @hair}, "public", ~w(now friends)},
    "beard" => {{:enum, @beards}, "public", :all},
    "tribes" => {{:multi, @tribes, 3}, "public", ~w(now friends)},
    "looking_for" => {{:multi, @looking_for, 7}, "public", ~w(now friends)},
    "relationship" => {{:enum, @relationship}, "public", ~w(now friends)},
    "creator" => {:bool, "public", ~w(now)},
    # hookup, default Verified (R-06.5); Hookup lens only
    "position" => {{:enum, @positions}, "verified", ~w(now)},
    "practices" => {{:multi, @practices, 10}, "verified", ~w(now)},
    "limits" => {{:multi, @practices, 10}, "verified", ~w(now)},
    "hosting" => {{:enum, @hosting}, "verified", ~w(now)},
    "groups" => {:bool, "verified", ~w(now)},
    "boundaries" => {{:text, 200}, "verified", ~w(now)},
    # health: default My chats, never Public
    "prep" => {{:enum, @prep}, "chats", ~w(now)},
    "hiv" => {{:enum, @hiv}, "chats", ~w(now)},
    "last_tested" => {{:month}, "chats", ~w(now)},
    # sport (F-11)
    "sports" => {{:multi, @sports, 8}, "public", ~w(sport)},
    "sport_level" => {{:enum, @levels}, "public", ~w(sport)},
    "gym" => {{:text, 60}, "verified", ~w(sport)},
    "schedule" => {{:multi, @schedule, 4}, "public", ~w(sport)},
    "sport_intent" => {{:enum, @intents}, "public", ~w(sport)},
    "clubs_visible" => {:bool, "verified", ~w(sport)}
  }

  @health ~w(prep hiv last_tested)
  @lenses ~w(hookup friends sport)
  # looking_for values never shown outside the Hookup lens (R-06.1b)
  @hookup_looking_for ~w(hookup now tonight)
  @visibilities ~w(public verified chats only_me)

  def catalogue, do: @catalogue
  def health, do: @health
  def lenses, do: @lenses

  @doc """
  F-06 R-06.1b: what a lens shows of already audience-filtered fields. Hookup shows everything;
  Friends shows identity/social fields; Sport adds the sport fields. Never hookup or health.
  """
  def lens(fields, "hookup"), do: fields

  def lens(fields, mode) when mode in ~w(friends sport) do
    fields
    |> Enum.filter(fn {k, _} -> in_lens?(k, mode) end)
    |> Map.new()
    |> then(fn f ->
      case f["looking_for"] do
        l when is_list(l) ->
          case l -- @hookup_looking_for do
            [] -> Map.delete(f, "looking_for")
            rest -> Map.put(f, "looking_for", rest)
          end

        _ ->
          f
      end
    end)
  end

  def lens(fields, _), do: lens(fields, "hookup")

  defp in_lens?(k, mode) do
    case Map.get(@catalogue, k) do
      {_, _, :all} -> true
      {_, _, kinds} -> "friends" in kinds or (mode == "sport" and "sport" in kinds)
      nil -> false
    end
  end

  def visibilities, do: @visibilities

  def sports, do: @sports

  def options do
    %{
      orientation: @orientations,
      build: @builds,
      body_hair: @hair,
      beard: @beards,
      tribes: @tribes,
      looking_for: @looking_for,
      position: @positions,
      practices: @practices,
      hosting: @hosting,
      prep: @prep,
      hiv: @hiv,
      sports: @sports,
      sport_level: @levels,
      schedule: @schedule,
      sport_intent: @intents,
      relationship: @relationship,
      prompt_q: @prompts,
      languages: @languages
    }
  end

  def default_visibility(key), do: elem(Map.fetch!(@catalogue, key), 1)

  def visibility(%{visibility_map: vm}, key),
    do: Map.get(vm || %{}, key) || default_visibility(key)

  @doc """
  Validates a PATCH. Returns {:ok, fields, visibility_map} with chats/only_me values removed,
  or {:error, {:validation, errors}}.
  """
  def apply(current_fields, current_vis, params_fields, params_vis) do
    params_fields = params_fields || %{}
    params_vis = params_vis || %{}

    with :ok <- check_keys(Map.keys(params_fields) ++ Map.keys(params_vis)),
         {:ok, vis} <- merge_visibility(current_vis || %{}, params_vis),
         {:ok, fields} <- merge_values(current_fields || %{}, params_fields) do
      # Drop values the server must not hold (R-06.4).
      fields =
        fields
        |> Enum.reject(fn {k, _} ->
          Map.get(vis, k, default_visibility(k)) in ~w(chats only_me)
        end)
        |> Map.new()

      {:ok, fields, vis}
    end
  end

  defp check_keys(keys) do
    bad = Enum.reject(keys, &Map.has_key?(@catalogue, &1))

    if bad == [],
      do: :ok,
      else: {:error, {:validation, Map.new(bad, &{&1, ["unknown field"]})}}
  end

  defp merge_visibility(current, params) do
    Enum.reduce_while(params, {:ok, current}, fn {k, v}, {:ok, acc} ->
      cond do
        v not in @visibilities ->
          {:halt, {:error, {:validation, %{k => ["invalid visibility"]}}}}

        k in @health and v == "public" ->
          {:halt, {:error, {:validation, %{k => ["health fields can't be public"]}}}}

        true ->
          {:cont, {:ok, Map.put(acc, k, v)}}
      end
    end)
  end

  defp merge_values(current, params) do
    Enum.reduce_while(params, {:ok, current}, fn {k, v}, {:ok, acc} ->
      {type, _, _} = Map.fetch!(@catalogue, k)

      case cast(type, v) do
        {:ok, nil} -> {:cont, {:ok, Map.delete(acc, k)}}
        {:ok, val} -> {:cont, {:ok, Map.put(acc, k, val)}}
        {:error, msg} -> {:halt, {:error, {:validation, %{k => [msg]}}}}
      end
    end)
  end

  defp cast(_, nil), do: {:ok, nil}
  defp cast(_, ""), do: {:ok, nil}
  defp cast(_, []), do: {:ok, nil}

  defp cast({:text, max}, v) when is_binary(v) do
    v = String.trim(v)
    if String.length(v) <= max, do: {:ok, v}, else: {:error, "max #{max} characters"}
  end

  defp cast({:enum, values}, v) when is_binary(v),
    do: if(v in values, do: {:ok, v}, else: {:error, "invalid value"})

  defp cast({:multi, values, max}, v) when is_list(v) do
    cond do
      not Enum.all?(v, &(&1 in values)) -> {:error, "invalid value"}
      length(Enum.uniq(v)) > max -> {:error, "max #{max}"}
      true -> {:ok, Enum.uniq(v)}
    end
  end

  defp cast({:int, min, max}, v) when is_integer(v) and v >= min and v <= max, do: {:ok, v}
  defp cast({:int, min, max}, _), do: {:error, "must be #{min}–#{max}"}
  defp cast(:bool, v) when is_boolean(v), do: {:ok, v}

  defp cast({:month}, v) when is_binary(v) do
    if Regex.match?(~r/^20\d\d-(0[1-9]|1[0-2])$/, v), do: {:ok, v}, else: {:error, "YYYY-MM"}
  end

  defp cast(_, _), do: {:error, "invalid value"}

  @doc "Fields a viewer may see (R-06.4, AC-06.1). `viewer` is :stranger | :verified | :self."
  def visible(fields, vis, :self), do: {fields, vis}

  def visible(fields, vis, viewer) do
    allowed = if viewer == :verified, do: ~w(public verified), else: ~w(public)

    shown =
      fields
      |> Enum.filter(fn {k, _} -> Map.get(vis, k, default_visibility(k)) in allowed end)
      |> Map.new()

    {shown, nil}
  end

  @doc """
  R-06.8 completeness ring (weights sum to 100). Onboarding basics count (owner decision
  2026-11-18, required-fields.md RF-12): name, age, I am and Here for = 20, main photo = 20,
  so a profile fresh out of onboarding reads 40 %, not 6 %.
  """
  def completeness(%{fields: f, photo_ids: photos} = p) do
    f = f || %{}
    has = &(Map.has_key?(f, &1) and f[&1] not in [nil, "", []])
    n_photos = length(photos || [])

    # Mode-specific step: hookup details when shown in Hookup, else sport details.
    hookup_keys =
      if "hookup" in (Map.get(p, :show_in) || ["hookup"]),
        do: ~w(position hosting),
        else: ~w(sports sport_level schedule)

    [
      {20, 1},
      {20, min(n_photos, 1)},
      {10, min(max(n_photos - 1, 0), 4) / 4},
      {10, if(has.("bio"), do: 1, else: 0)},
      {10, Enum.count(~w(height_cm build), has) / 2},
      {5, if(has.("looking_for") or has.("sport_intent"), do: 1, else: 0)},
      {10, Enum.count(hookup_keys, has) / length(hookup_keys)},
      {5, if(has.("prompt_a"), do: 1, else: 0)},
      {10, if(has.("languages"), do: 1, else: 0)}
    ]
    |> Enum.map(fn {w, share} -> w * share end)
    |> Enum.sum()
    |> round()
  end
end
