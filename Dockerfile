ARG OTEL_COLLECTOR_IMAGE=otel/opentelemetry-collector-contrib:0.123.0
FROM ${OTEL_COLLECTOR_IMAGE} AS collector

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=collector /otelcol-contrib /usr/local/bin/otelcol-contrib
COPY package.json server.mjs otel-collector.yaml start.sh ./
COPY lib ./lib
COPY public ./public
RUN chmod 0555 /app/start.sh && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["/app/start.sh"]
