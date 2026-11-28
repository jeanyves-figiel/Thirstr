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
    # EN-23 OB-6: console Health page cache (60 s)
    Thirstr.Health.init_cache()
    # R-AD.18 (#326): count SES recipients for the cost page
    Thirstr.Costs.attach_mail_meter()

    children = [
      ThirstrWeb.Telemetry,
      Thirstr.Repo,
      Thirstr.Valkey,
      {DNSCluster, query: Application.get_env(:thirstr, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Thirstr.PubSub},
      # EN-23 OB-1: cluster-wide live envelope sockets (:pg scope)
      Thirstr.Delivery,
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
