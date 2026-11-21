defmodule Thirstr.Jobs.FeedbackIssue do
  @moduledoc """
  F-22 R-22.32: files one feedback row as a GitHub issue. Retries with backoff; after 24 h the
  text is dropped and counted (`thirstr_feedback_dropped_total`, R-22.34).
  """
  use Oban.Worker, queue: :default, max_attempts: 12, unique: [period: 60, keys: [:id]]

  @impl true
  def perform(%Oban.Job{args: %{"id" => id}}), do: Thirstr.Feedback.file(id)

  # 1 min, 2, 4, … capped at 4 h (≈ 24 h over 12 attempts)
  @impl true
  def backoff(%Oban.Job{attempt: n}), do: min(60 * Integer.pow(2, n - 1), 4 * 3600)
end
