defmodule Thirstr.Moderation.HashMatch do
  @moduledoc """
  F-15 R-15.40–46 (#179): known-CSAM hash match on every public image **before** it is published
  (contract in docs/spec/integrations/I04-hash-matching.md). Runs before the classifier.

  Order: exact-bytes blocklist (SHA-256, no vendor call) → provider (`noop` until the PhotoDNA keys
  arrive, `dev` in DEV/test, `photodna`). Fail-closed: a provider error never publishes.
  """
  require Logger
  alias Thirstr.{Moderation, Repo, Storage}

  @type meta :: map()
  @callback match(key :: String.t(), bytes :: binary()) ::
              {:no_match, meta} | {:match, meta} | {:unchecked, meta} | {:error, term()}

  @retries 2

  def impl, do: Application.get_env(:thirstr, :hash_match, __MODULE__.Noop)

  @doc """
  Checks one stored object. Returns `{state, meta}` with state `:no_match | :unchecked` (go on),
  `:match` (block, R-15.44) or `:retry` (provider down; keep hidden, R-15.43).
  """
  def check(key) do
    case Storage.get(key) do
      {:ok, bytes} ->
        sha = :crypto.hash(:sha256, bytes)

        if blocklisted?(sha),
          do: {:match, %{"provider" => "internal", "sha256" => sha}},
          else: key |> call(bytes, @retries) |> with_sha(sha)

      _ ->
        {:retry, %{"error" => "unreadable"}}
    end
  end

  @doc """
  Gate for one public image and its card-size copy (`thumb`, SR-10): `{:ok, columns, thumb_ok?}`
  to go on, `{:match, meta, matched_key}` (R-15.44) or `{:retry, meta}` (R-15.43). A thumb that
  can't be checked is dropped (cards fall back to the full photo); a thumb that matches is a hit.
  """
  def gate(key, thumb) do
    case check(key) do
      {:match, m} ->
        {:match, m, key}

      {:retry, m} ->
        {:retry, m}

      {state, m} ->
        case thumb && Storage.head(thumb) do
          {:ok, %{size: n}} when n > 0 ->
            case check(thumb) do
              {:match, tm} -> {:match, tm, thumb}
              {:retry, _} -> {:ok, columns(state, m), false}
              _ -> {:ok, columns(state, m), true}
            end

          _ ->
            {:ok, columns(state, m), true}
        end
    end
  end

  defp call(key, bytes, left) do
    if Thirstr.Flags.enabled?("hash_match") do
      case impl().match(key, bytes) do
        {:error, reason} when left > 0 ->
          Process.sleep(100 + :rand.uniform(200))
          Logger.warning("hash match retry: #{inspect(reason)}")
          call(key, bytes, left - 1)

        {:error, reason} ->
          {:retry, %{"error" => inspect(reason)}}

        other ->
          other
      end
    else
      {:unchecked, %{"provider" => "off"}}
    end
  end

  defp with_sha({state, meta}, sha), do: {state, Map.put(meta, "sha256", sha)}

  def provider_name, do: impl() |> Module.split() |> List.last() |> String.downcase()

  @doc "Hash columns for a photo/moment row after a check."
  def columns(state, meta) do
    %{
      hash_state: Atom.to_string(state),
      hash_checked_at: DateTime.utc_now(),
      hash_provider: meta["provider"] || provider_name()
    }
  end

  defp blocklisted?(sha),
    do: Repo.query!("SELECT 1 FROM hash_blocklist WHERE sha256 = $1", [sha]).num_rows > 0

  @doc """
  R-15.44: opens a tier-0 case, quarantines the account. The object stays in storage as evidence
  (never served: the row is rejected or gone); #287 moves it to the encrypted evidence store.
  """
  def open_case(account, attrs, meta) do
    id = Ecto.UUID.generate()

    Repo.query!(
      """
      INSERT INTO csam_cases (id, source, provider, match_ref, target_account, photo_id, moment_id,
                              sha256, evidence_key, snapshot, hold_until)
      VALUES ($1, $10, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '1 year')
      """,
      [
        Ecto.UUID.dump!(id),
        meta["provider"] || provider_name(),
        meta["match_id"],
        Ecto.UUID.dump!(account.id),
        dump(attrs[:photo_id]),
        dump(attrs[:moment_id]),
        meta["sha256"],
        attrs[:key],
        attrs[:snapshot] || %{},
        attrs[:source] || "hash"
      ]
    )

    Moderation.auto_quarantine(account, "csam_hash")
    Logger.error("csam hash case opened")
    {:ok, id}
  end

  defp dump(nil), do: nil
  defp dump(id), do: Ecto.UUID.dump!(id)
end

defmodule Thirstr.Moderation.HashMatch.Noop do
  @moduledoc "Until the PhotoDNA keys arrive: nothing is matched, rows are marked `unchecked` for the backfill (R-15.46)."
  @behaviour Thirstr.Moderation.HashMatch
  @impl true
  def match(_key, _bytes), do: {:unchecked, %{"provider" => "noop"}}
end

defmodule Thirstr.Moderation.HashMatch.Dev do
  @moduledoc "DEV/test: keys ending `-hashhit` match, `-hasherror` fail; everything else is clean."
  @behaviour Thirstr.Moderation.HashMatch
  @impl true
  def match(key, _bytes) do
    cond do
      String.ends_with?(key, "-hashhit") ->
        {:match, %{"provider" => "dev", "match_id" => "dev-1"}}

      String.ends_with?(key, "-hasherror") ->
        {:error, :dev_error}

      true ->
        {:no_match, %{"provider" => "dev"}}
    end
  end
end

defmodule Thirstr.Moderation.HashMatch.PhotoDNA do
  @moduledoc """
  Microsoft PhotoDNA Cloud Service (I-04). The Match call is written against the developer portal
  spec once the owner's application is approved; until then it fails closed.
  """
  @behaviour Thirstr.Moderation.HashMatch
  @impl true
  def match(_key, _bytes) do
    if Application.get_env(:thirstr, :photodna_key) in [nil, ""],
      do: {:error, :not_configured},
      else: {:error, :adapter_pending}
  end
end
