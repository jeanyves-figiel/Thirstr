# Postgres 16 + h3-pg (ADR-0001). Used by DEV compose, CI and the Fly DB machine.
# Backups (SR-01, #141): pgBackRest → encrypted repo in the env's Tigris bucket (WAL archive for
# point-in-time restore + scheduled base backups). Off unless PGBACKREST_REPO1_S3_BUCKET is set,
# so DEV and CI run plain Postgres. Runbook: docs/runbooks/db-backups.md.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-h3 pgbackrest jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY thirstr-entrypoint.sh backup-loop.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/thirstr-entrypoint.sh /usr/local/bin/backup-loop.sh
ENTRYPOINT ["thirstr-entrypoint.sh"]
CMD ["postgres"]
