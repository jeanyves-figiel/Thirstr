defmodule Thirstr.Moderation.Classifier do
  @moduledoc """
  Public-photo classifier contract (F-15 R-15.10, mapping in docs/spec/beta-build-plan.md).
  Implementations: `DevClassifier` (DEV/test), `NudeNetClassifier` (self-hosted service).
  Scores map always carries `"main_ok"` so a public photo can later be promoted to main.
  """
  @type verdict ::
          {:ok_main | :ok_public | :review, map()}
          | {:rejected, :too_explicit | :no_person, map()}
  @callback classify(storage_key :: String.t(), slot :: non_neg_integer(), kind :: String.t()) ::
              verdict

  def impl, do: Application.fetch_env!(:thirstr, :photo_classifier)

  @main_block ~w(FEMALE_GENITALIA_EXPOSED MALE_GENITALIA_EXPOSED ANUS_EXPOSED BUTTOCKS_EXPOSED FEMALE_BREAST_EXPOSED)
  @public_block ~w(FEMALE_GENITALIA_EXPOSED MALE_GENITALIA_EXPOSED ANUS_EXPOSED)
  @sport_block @main_block ++ ~w(MALE_GENITALIA_COVERED FEMALE_GENITALIA_COVERED)
  @person ~w(FACE_MALE FACE_FEMALE MALE_BREAST_EXPOSED BELLY_EXPOSED ARMPITS_EXPOSED FEET_EXPOSED)

  @doc """
  Maps detector output `[%{"class" => label, "score" => float}]` to a verdict (R-15.10):
  ≥ 0.6 on a blocked label rejects, 0.4–0.6 goes to human review (auto-hidden, R-15.13).
  """
  def decide(detections, slot, kind) do
    detections = drop_chest_confusion(detections)

    max = fn labels ->
      detections
      |> Enum.filter(&(&1["class"] in labels))
      |> Enum.map(& &1["score"])
      |> Enum.max(fn -> 0.0 end)
    end

    main_score = max.(@main_block)
    person = detections != [] and max.(@person ++ @main_block ++ @public_block) > 0.3

    block =
      cond do
        kind == "sport" -> @sport_block
        slot == 0 -> @main_block
        true -> @public_block
      end

    score = max.(block)
    scores = %{"explicit" => score, "main_ok" => main_score < 0.4 and person, "person" => person}

    cond do
      slot == 0 and not person -> {:rejected, :no_person, scores}
      score >= 0.6 -> {:rejected, :too_explicit, scores}
      score >= 0.4 -> {:review, scores}
      slot == 0 -> {:ok_main, scores}
      true -> {:ok_public, scores}
    end
  end

  # NudeNet often tags a shirtless man's chest as FEMALE_BREAST_EXPOSED next to a stronger
  # MALE_BREAST_EXPOSED (seen on staging, #26). Shirtless is allowed even on the main photo
  # (R-15.10), so the female label only counts when it beats the male one on the same photo.
  defp drop_chest_confusion(detections) do
    score = fn label ->
      detections
      |> Enum.filter(&(&1["class"] == label))
      |> Enum.map(& &1["score"])
      |> Enum.max(fn -> 0.0 end)
    end

    if score.("MALE_BREAST_EXPOSED") >= score.("FEMALE_BREAST_EXPOSED"),
      do: Enum.reject(detections, &(&1["class"] == "FEMALE_BREAST_EXPOSED")),
      else: detections
  end
end

defmodule Thirstr.Moderation.DevClassifier do
  @moduledoc """
  DEV/test stand-in. Accepts any uploaded image; keys ending in `-explicit`, `-noperson` or
  `-borderline` exercise rejection and review states.
  """
  @behaviour Thirstr.Moderation.Classifier
  alias Thirstr.Moderation.Classifier

  @impl true
  def classify(key, slot, kind) do
    det =
      cond do
        String.ends_with?(key, "-explicit") ->
          [%{"class" => "MALE_GENITALIA_EXPOSED", "score" => 0.9}]

        String.ends_with?(key, "-borderline") ->
          [
            %{"class" => "BUTTOCKS_EXPOSED", "score" => 0.5},
            %{"class" => "FACE_MALE", "score" => 0.9}
          ]

        String.ends_with?(key, "-noperson") ->
          []

        true ->
          [%{"class" => "FACE_MALE", "score" => 0.95}]
      end

    Classifier.decide(det, slot, kind)
  end
end

defmodule Thirstr.Moderation.NudeNetClassifier do
  @moduledoc """
  Self-hosted NudeNet service (infra/classifier). The API passes a short-lived presigned GET
  URL; the service fetches, detects and forgets the image. No third party involved.
  """
  @behaviour Thirstr.Moderation.Classifier
  alias Thirstr.Moderation.Classifier

  @impl true
  def classify(key, slot, kind) do
    url = Application.fetch_env!(:thirstr, :classifier_url)

    token = Application.get_env(:thirstr, :classifier_token)
    headers = if token, do: [authorization: "Bearer " <> token], else: []

    opts =
      [
        json: %{url: Thirstr.Storage.internal_presigned_get(key)},
        headers: headers,
        receive_timeout: 20_000,
        retry: :transient,
        # .flycast / .internal names resolve to IPv6 only (Fly private network).
        inet6: true
      ] ++ Application.get_env(:thirstr, :classifier_req_options, [])

    case Req.post(url <> "/detect", opts) do
      {:ok, %{status: 200, body: %{"detections" => det}}} -> Classifier.decide(det, slot, kind)
      # Service down: never auto-approve; queue for human review (hidden until reviewed).
      _ -> {:review, %{"error" => true, "main_ok" => false}}
    end
  end
end
