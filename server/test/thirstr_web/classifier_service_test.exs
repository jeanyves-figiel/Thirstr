defmodule ThirstrWeb.ClassifierServiceTest do
  @moduledoc "NudeNet service client (F-15 R-15.10, #26): token, mapping, fail-closed."
  use ThirstrWeb.ConnCase, async: false
  alias Thirstr.Moderation.NudeNetClassifier

  setup do
    Application.put_env(:thirstr, :classifier_url, "http://classifier.test")
    Application.put_env(:thirstr, :classifier_token, "s3cret")

    Application.put_env(:thirstr, :classifier_req_options,
      plug: {Req.Test, __MODULE__},
      retry: false
    )

    on_exit(fn ->
      for k <- [:classifier_token, :classifier_req_options],
          do: Application.delete_env(:thirstr, k)
    end)
  end

  defp stub(status, body) do
    Req.Test.stub(__MODULE__, fn conn ->
      assert Plug.Conn.get_req_header(conn, "authorization") == ["Bearer s3cret"]
      {:ok, raw, conn} = Plug.Conn.read_body(conn)
      assert %{"url" => "http" <> _} = Jason.decode!(raw)

      conn
      |> Plug.Conn.put_resp_content_type("application/json")
      |> Plug.Conn.send_resp(status, Jason.encode!(body))
    end)
  end

  test "main photo: face passes, exposed genitals rejected" do
    stub(200, %{detections: [%{class: "FACE_MALE", score: 0.9}]})
    assert {:ok_main, %{"main_ok" => true}} = NudeNetClassifier.classify("k", 0, "now")

    stub(200, %{
      detections: [
        %{class: "FACE_MALE", score: 0.9},
        %{class: "MALE_GENITALIA_EXPOSED", score: 0.8}
      ]
    })

    assert {:rejected, :too_explicit, _} = NudeNetClassifier.classify("k", 0, "now")
  end

  test "other public photos may be spicy (bare buttocks ok), genitals still rejected" do
    stub(200, %{detections: [%{class: "BUTTOCKS_EXPOSED", score: 0.9}]})
    assert {:ok_public, %{"main_ok" => false}} = NudeNetClassifier.classify("k", 2, "now")
  end

  test "shirtless man on the main photo passes (female-breast confusion ignored)" do
    stub(200, %{
      detections: [
        %{class: "BELLY_EXPOSED", score: 0.79},
        %{class: "MALE_BREAST_EXPOSED", score: 0.702},
        %{class: "FEMALE_BREAST_EXPOSED", score: 0.535},
        %{class: "FACE_FEMALE", score: 0.508}
      ]
    })

    assert {:ok_main, %{"main_ok" => true}} = NudeNetClassifier.classify("k", 0, "now")

    stub(200, %{
      detections: [
        %{class: "FACE_FEMALE", score: 0.8},
        %{class: "FEMALE_BREAST_EXPOSED", score: 0.8}
      ]
    })

    assert {:rejected, :too_explicit, _} = NudeNetClassifier.classify("k", 0, "now")
  end

  test "service down or error never auto-approves" do
    stub(422, %{error: "ValueError"})
    assert {:review, %{"error" => true}} = NudeNetClassifier.classify("k", 0, "now")
  end
end
