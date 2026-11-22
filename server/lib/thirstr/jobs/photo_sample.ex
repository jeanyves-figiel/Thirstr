defmodule Thirstr.Jobs.PhotoSample do
  @moduledoc """
  F-15 R-15.56 (#325): once a day, marks a random sample of live photos (last 7 days) for the
  after-publish review in console A-03. Count: `PHOTO_SAMPLE_PER_DAY` (default 20).
  """
  use Oban.Worker, queue: :maintenance, unique: [period: 3600]

  @impl true
  def perform(_job) do
    Thirstr.Profiles.sample_live_photos()
    :ok
  end
end
