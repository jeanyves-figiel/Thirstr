# Release image for staging/prod (ops.md). Built once per main commit, deployed by digest.
# Build context: repository root (docker build -f server/Dockerfile .).
ARG ELIXIR_VERSION=1.17.3
ARG OTP_VERSION=27.1.2
ARG DEBIAN_VERSION=bookworm-20241016-slim
ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

# Public marketing site (W-01, docs/spec/website.md): static build, no dependencies.
FROM node:22-bookworm-slim AS site
WORKDIR /site
COPY web/site ./
RUN node build.mjs /site/dist

# Offline IP → city (R-02.2, #26): DB-IP City Lite, CC BY 4.0. Own stage so the download is
# cached per DBIP_MONTH (deploy workflow passes YYYY-MM); the IP never leaves our machines.
FROM ${BUILDER_IMAGE} AS geo
RUN apt-get update -y && apt-get install -y ca-certificates && apt-get clean && rm -f /var/lib/apt/lists/*_*
ARG DBIP_MONTH=
WORKDIR /geo
COPY server/lib/thirstr/geo/geo_db_builder.ex server/rel/geo/build.exs ./
RUN mkdir -p out && elixir -r geo_db_builder.ex build.exs out/city.tgeo ${DBIP_MONTH}

FROM ${BUILDER_IMAGE} AS builder
RUN apt-get update -y && apt-get install -y build-essential git && apt-get clean && rm -f /var/lib/apt/lists/*_*
WORKDIR /app
RUN mix local.hex --force && mix local.rebar --force
ENV MIX_ENV="prod"
COPY server/mix.exs server/mix.lock ./
RUN mix deps.get --only $MIX_ENV
RUN mkdir config
COPY server/config/config.exs server/config/${MIX_ENV}.exs config/
RUN mix deps.compile
COPY server/priv priv
COPY --from=site /site/dist priv/static/site
COPY --from=geo /geo/out priv/geo
COPY server/lib lib
RUN mix compile
COPY server/config/runtime.exs config/
COPY server/rel rel
RUN mix release

FROM ${RUNNER_IMAGE}
RUN apt-get update -y && \
    apt-get install -y libstdc++6 openssl libncurses5 locales ca-certificates && \
    apt-get clean && rm -f /var/lib/apt/lists/*_*
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8
WORKDIR /app
RUN chown nobody /app
ENV MIX_ENV="prod"
COPY --from=builder --chown=nobody:root /app/_build/${MIX_ENV}/rel/thirstr ./
USER nobody
ARG RELEASE_SHA=dev
ENV RELEASE_SHA=${RELEASE_SHA}
# IPv6 for Fly 6PN private network + clustering
ENV ECTO_IPV6=true ERL_AFLAGS="-proto_dist inet6_tcp"
CMD ["/app/bin/server"]
