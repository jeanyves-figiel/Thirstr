# F-12 R-12.9 (#113): run on a Fly machine via `bin/thirstr rpc`. Queues the OSM import job
# (same as admin › Places › Import now) or prints the latest import row. `action` comes from the
# eval binding: env vars set on the rpc client never reach the server node.
alias Thirstr.Repo
case binding()[:action] do
  "start" ->
    # A deploy mid-import kills the job but leaves it "executing" (and its import row "running"),
    # which also blocks a new insert through `unique`. Anything attempted before this node booted is dead.
    {up_ms, _} = :erlang.statistics(:wall_clock)
    booted = DateTime.add(DateTime.utc_now(), -up_ms, :millisecond)
    %{rows: dead} = Repo.query!("SELECT id FROM oban_jobs WHERE worker = 'Thirstr.Jobs.PlaceImport' AND state = 'executing' AND attempted_at < $1", [booted])
    Enum.each(dead, fn [id] -> Oban.cancel_job(id) end)
    Repo.query!("UPDATE place_imports SET finished_at = now(), error = 'interrupted by a restart' WHERE finished_at IS NULL AND started_at < $1", [booted])
    if dead != [], do: IO.puts("cancelled #{length(dead)} interrupted import job(s)")
    {:ok, job} = Oban.insert(Thirstr.Jobs.PlaceImport.new(%{}))
    IO.puts("queued job #{job.id} enabled=#{Thirstr.Places.OsmImport.enabled?()}")
  _ ->
    %{rows: rows} = Repo.query!("SELECT id, started_at, finished_at, added, updated, removed, error FROM place_imports ORDER BY id DESC LIMIT 1")
    %{rows: [[n]]} = Repo.query!("SELECT count(*) FROM venues WHERE NOT hidden")
    case rows do
      [[id, st, fin, a, u, r, e]] -> IO.puts("import #{id} started=#{st} finished=#{fin || "running"} added=#{a} updated=#{u} removed=#{r} error=#{e || "none"} venues=#{n}")
      [] -> IO.puts("no import yet venues=#{n}")
    end
end
