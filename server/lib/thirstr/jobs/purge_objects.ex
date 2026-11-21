defmodule Thirstr.Jobs.PurgeObjects do
  @moduledoc "Deletes object-storage keys after account deletion (R-01.10, AC-01.4)."
  use Oban.Worker, queue: :maintenance, max_attempts: 20

  @impl true
  def perform(%Oban.Job{args: %{"keys" => keys}}), do: Thirstr.Storage.delete_many(keys)
end
