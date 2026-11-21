# DEV/staging fake data (testing.md). Never run against production.
{:ok, _} =
  Thirstr.Storage.ensure_bucket()
  |> then(fn
    {:error, {:http_error, 409, _}} -> {:ok, :exists}
    other -> other
  end)

Thirstr.Seeds.run()
