# Atlas OTel Metrics Sink — meetup demo

A small, repo-ready demo that receives **OTLP/HTTP metrics**, passes them through the OpenTelemetry Collector, and renders recent values in a browser dashboard.

- **Atlas → dashboard:** Atlas sends metrics to the public `POST /v1/metrics` endpoint; the app proxies the OTLP payload to the Collector.
- **Application metrics → dashboard:** an instrumented app can send OTLP metrics to the same endpoint. Instrumentation is separate from the Atlas sink.
- **Dashboard:** polls the Collector's Prometheus exporter every five seconds and draws a short, browser-only history.
- **Synthetic mode:** local button and optional generator script submit clearly labeled app/database-like test metrics. These validate the receiver/UI pipeline only; they are not Atlas telemetry.

This is a meetup/demo starter, not a production observability backend. It has no durable metric storage, alerting, multi-tenant isolation, or long-term retention.

## Run locally

Requirements: Docker Desktop / Docker Engine with the Compose plugin.

```sh
cp .env.example .env
# Edit .env. For local use, replace both example secrets with random values.
docker compose up --build
```

Open <http://localhost:3000>. The OTLP endpoint is `http://localhost:3000/v1/metrics` for local senders. Enter the `DASHBOARD_TOKEN` value in the dashboard if you set one. Click **Generate synthetic sample** to confirm the dashboard pipeline; those values are labeled synthetic.

Optionally, stream synthetic application signals continuously in another terminal (after `docker compose up`):

```sh
OTEL_AUTH_HEADER_VALUE="Bearer local-demo-only-change-me" node scripts/generate-app-metrics.mjs
```

This emits changing request/model/retrieval latency, context-token, and error-rate gauges with `service.name=sample-ai-chat-app`. It is a synthetic sender for the presentation—not an AI app or real application instrumentation. Stop it with Ctrl+C.

Run the small parser tests without Docker:

```sh
npm test
```

## Connect Atlas

Atlas requires an OTLP-compatible destination that Atlas can reach over the public internet using TLS. The GA product update describes project-owner configuration of an endpoint and authentication, and says the sink is available for Dedicated clusters on M10+ tiers. See [Now GA: Atlas OpenTelemetry Metrics Sink](https://www.mongodb.com/products/updates/now-ga-mongodb-atlas-opentelemetry-metrics-sink).

1. Deploy this container to a host that gives it a **public HTTPS URL** (for example, a Docker-capable web service). The local `localhost` URL is not reachable by Atlas.
2. Set strong, separate `OTEL_AUTH_HEADER_VALUE` and `DASHBOARD_TOKEN` secrets in the host's environment. For a bearer-token auth option, set the receiver value to `Bearer <long-random-secret>` and configure the same token in Atlas. If the Atlas UI offers a different supported auth mode, configure the exact corresponding Authorization header value here (for Basic auth, for example, use `Basic <base64-credentials>`). Never commit these values.
3. In the Atlas OTel Metrics Sink configuration, use the service's HTTPS URL with the OTLP metrics path, e.g. `https://YOUR-SERVICE.example/v1/metrics`, and configure matching authentication. Use the integration's **Test** action, then check whether fresh series appear in this dashboard.
4. If the Atlas UI or docs for your project show a different endpoint/path or auth contract, follow that UI and adjust the gateway route accordingly. The public setup page can surface an older Stream Processing integration flow; the GA update is the reference for the newer Atlas Metrics Sink.

The receiver intentionally requires auth when `NODE_ENV=production`, limits incoming request bodies, and offers the synthetic-generator route only when enabled. Keep the dashboard token private; metric names and labels can expose operational details even in a demo.

## Generate real Atlas database activity (read-only)

For the meetup, use a **dedicated Atlas demo project/cluster**. The OTel Metrics Sink requires a supported Dedicated cluster (the GA announcement specifies M10+). Load Atlas's `sample_mflix` sample dataset into that cluster, create a database user with read-only access to `sample_mflix`, and allow your laptop's current IP in the project's network access list. Do not use a production or shared cluster.

This is a sample dataset, not a special “sample cluster.” The workload script below runs a few bounded reads against `sample_mflix.movies`; it does not write data, run a stress test, or send metrics to the dashboard. Atlas's separately configured OTel Metrics Sink sends Atlas telemetry.

Install the Node.js driver once from the project root:

```sh
npm install
```

Set your Atlas connection string in the terminal (keep it secret; do not commit it):

```sh
export MONGODB_URI='mongodb+srv://<demo-user>:<password>@<cluster-host>/?retryWrites=true&w=majority'
export DEMO_WORKLOAD_CONFIRM=YES
node scripts/run-atlas-readonly-workload.mjs
```

PowerShell equivalent:

```powershell
$env:MONGODB_URI='mongodb+srv://<demo-user>:<password>@<cluster-host>/?retryWrites=true&w=majority'
$env:DEMO_WORKLOAD_CONFIRM='YES'
node .\scripts\run-atlas-readonly-workload.mjs
```

Defaults: 5 minutes, one small read cycle about every 4 seconds, hard maximum 30 minutes. Stop early with Ctrl+C. Optional controls are `DURATION_MINUTES` (1–30) and `INTERVAL_MS` (1,000–30,000); the script only permits `sample_mflix.movies`. Run this separately from the dashboard/Collector stack.

**Demo limitation:** the workload creates database activity, but does not guarantee a visible spike or a particular metric. Configure and test the Atlas OTel Metrics Sink beforehand, allow time for its reporting interval, and confirm actual Atlas series arrive at the receiver. Do not claim that an individual query caused a metric change unless you have separately correlated it with application traces/logs.

## Public deployment

Use a Docker-capable web-service host with HTTPS and a persistent running container (Render, Fly.io, Railway, or similar). Configure:

```text
NODE_ENV=production
OTEL_AUTH_HEADER_VALUE=Bearer <strong-random-ingest-secret>
DASHBOARD_TOKEN=<different-strong-dashboard-secret>
ENABLE_DEMO_SEED=false
MAX_OTLP_BODY_BYTES=2097152
```

Set the platform's web port to the service's `PORT` environment variable (the app listens on `PORT`, default 3000). The public app serves the dashboard and receives `/v1/metrics` on the same HTTPS origin; it forwards requests privately to the Collector in the same container.

**Netlify note:** a static Netlify site alone cannot run the Collector process or provide this receiver. You can host the UI there only if you separately deploy a secured OTLP receiver/Collector backend and point the UI at that backend. For this demo, deploying the whole Docker service is simpler.

For a quick local proof with Atlas, you may use a temporary HTTPS tunnel to the local app, but only with both secrets enabled and a dedicated demo Atlas project. A public Docker service is preferable for a live meetup because it avoids tunnel stability and firewall surprises.

## What the dashboard does and does not show

- The Collector's Prometheus exporter exposes the latest in-memory metrics; the browser samples it every five seconds and retains only a short session history.
- Real Atlas series are whichever metrics Atlas emits to the configured integration. The demo does not hardcode or promise a particular Atlas metric name.
- Application metrics can be sent separately to the same OTLP metrics route by an instrumented application. The optional generator demonstrates that flow with synthetic values; this project does not auto-instrument a real app and does not currently receive traces or logs.
- The synthetic button emits `demo_*` gauges with a `telemetry.demo=true` resource attribute. Treat them as UI/transport tests, not Atlas measurements.
- Metric labels are not displayed in the UI to reduce accidental exposure of cluster or environment identifiers.

## Demo run of show (about 5 minutes)

1. Start on the dashboard in its clean state; explain that a database metric and an app metric answer different questions.
2. (Optional rehearsal only) Click **Generate synthetic sample** to show that the UI can receive OTLP data; call out that it is simulated.
3. For the live Atlas segment, use a dedicated demo project, trigger a repeatable workload, and wait for actual Atlas series. Point out the metric names/values arriving, and compare with separately instrumented app metrics if you have them.
4. (Optional) Run `scripts/generate-app-metrics.mjs` to show a separate `service.name=sample-ai-chat-app` stream beside Atlas metrics. Explain that this sender is synthetic; a real app must be instrumented separately.
5. Explain the limit: metrics reveal patterns and timing; they do not automatically correlate an individual AI request. Add app traces separately if you want request-level causality.
6. If data fails to appear, switch to a pre-captured screenshot/short recording; don't troubleshoot credentials on stage.

## Configuration / reference

- `otel-collector.yaml` — OTLP/HTTP receiver and Prometheus exporter; internal ports bind to loopback.
- `server.mjs` — public HTTP gateway, auth, size limit, dashboard API, and synthetic sample route.
- `public/` — browser dashboard.
- [Atlas OTel integration setup](https://www.mongodb.com/docs/atlas/tutorial/otel-integration/?otel-integration-type=custom) — verify the current project UI, because setup documentation may describe a separate/older integration surface.
- [GA announcement](https://www.mongodb.com/products/updates/now-ga-mongodb-atlas-opentelemetry-metrics-sink).
