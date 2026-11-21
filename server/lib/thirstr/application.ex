defmodule Thirstr.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    # SR-11: per-node rate-limit window used while Valkey is unreachable.
    Thirstr.Valkey.init_local()
    Thirstr.Nearby.init_cache()
    Thirstr.Flags.init_cache()
    Thirstr.Explore.init_cache()

    children = [
      ThirstrWeb.Telemetry,
      Thirstr.Repo,
      Thirstr.Valkey,
      {DNSCluster, query: Application.get_env(:thirstr, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Thirstr.PubSub},
      {Finch, name: Thirstr.Finch},
      {Task.Supervisor, name: Thirstr.TaskSup},
      {Oban, Application.fetch_env!(:thirstr, Oban)},
      ThirstrWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Thirstr.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    ThirstrWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
