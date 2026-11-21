defmodule ThirstrWeb.StorageUrlTest do
  # SR-10 (#150): same object → same URL within the window, so phone caches hit.
  use ExUnit.Case, async: true

  test "presigned GET URL is stable across calls" do
    a = Thirstr.Storage.presigned_get("photos/x.jpg")
    Process.sleep(1100)
    assert a == Thirstr.Storage.presigned_get("photos/x.jpg")
    assert a =~ "X-Amz-Expires=43200"
  end
end
