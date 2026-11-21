defmodule ThirstrWeb.ConnCase do
  @moduledoc """
  This module defines the test case to be used by
  tests that require setting up a connection.

  Such tests rely on `Phoenix.ConnTest` and also
  import other functionality to make it easier
  to build common data structures and query the data layer.

  Finally, if the test case interacts with the database,
  we enable the SQL sandbox, so changes done to the database
  are reverted at the end of every test. If you are using
  PostgreSQL, you can even run database tests asynchronously
  by setting `use ThirstrWeb.ConnCase, async: true`, although
  this option is not recommended for other databases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      # The default endpoint for testing
      @endpoint ThirstrWeb.Endpoint

      use ThirstrWeb, :verified_routes

      # Import conveniences for testing with connections
      import Plug.Conn
      import Phoenix.ConnTest
      import ThirstrWeb.ConnCase
      import ThirstrWeb.TestHelpers
    end
  end

  setup tags do
    Thirstr.DataCase.setup_sandbox(tags)
    Thirstr.Valkey.command!(["FLUSHDB"])

    {:ok,
     conn:
       Phoenix.ConnTest.build_conn()
       |> Plug.Conn.put_req_header("x-thirstr-install", "test-install-0123456789")}
  end
end
