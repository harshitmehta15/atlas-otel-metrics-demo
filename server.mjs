import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { parsePrometheusText } from './lib/prometheus.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = Number(process.env.MAX_OTLP_BODY_BYTES || 2 * 1024 * 1024);
const COLLECTOR_METRICS_URL = 'http://127.0.0.1:9464/metrics';
const COLLECTOR_OTLP_URL = 'http://127.0.0.1:4318/v1/metrics';
const OTEL_AUTH_HEADER_VALUE = process.env.OTEL_AUTH_HEADER_VALUE || '';
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';
const DEMO_ENABLED = process.env.ENABLE_DEMO_SEED === 'true';

if (process.env.NODE_ENV === 'production' && !OTEL_AUTH_HEADER_VALUE) {
  console.error('Refusing to start in production without OTEL_AUTH_HEADER_VALUE.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !DASHBOARD_TOKEN) {
  console.error('Refusing to start in production without DASHBOARD_TOKEN.');
  process.exit(1);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function constantTimeMatch(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkReceiverAuth(req) {
  if (!OTEL_AUTH_HEADER_VALUE) return true;
  return constantTimeMatch(req.headers.authorization, OTEL_AUTH_HEADER_VALUE);
}

function checkDashboardAuth(req, res) {
  if (!DASHBOARD_TOKEN) return true;
  if (constantTimeMatch(req.headers['x-dashboard-token'], DASHBOARD_TOKEN)) return true;
  json(res, 401, { error: 'Dashboard access token required.' });
  return false;
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= MAX_BODY) chunks.push(chunk);
  }
  if (bytes > MAX_BODY) {
    const error = new Error(`OTLP request exceeds ${MAX_BODY} bytes.`);
    error.statusCode = 413;
    throw error;
  }
  return Buffer.concat(chunks);
}

async function getCollectorMetrics() {
  const response = await fetch(COLLECTOR_METRICS_URL, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Collector scrape returned HTTP ${response.status}`);
  return parsePrometheusText(await response.text());
}

function proxyToCollector(body, req, res) {
  const headers = {
    'content-type': req.headers['content-type'] || 'application/x-protobuf',
    'content-length': body.length,
    accept: req.headers.accept || 'application/x-protobuf, application/json'
  };
  if (req.headers['content-encoding']) headers['content-encoding'] = req.headers['content-encoding'];

  const upstream = http.request(COLLECTOR_OTLP_URL, { method: 'POST', headers }, (upstreamRes) => {
    const responseChunks = [];
    let total = 0;
    upstreamRes.on('data', (chunk) => {
      total += chunk.length;
      if (total <= 1024 * 1024) responseChunks.push(chunk);
    });
    upstreamRes.on('end', () => {
      if (total > 1024 * 1024) {
        json(res, 502, { error: 'Collector response exceeded limit.' });
        return;
      }
      const responseBody = Buffer.concat(responseChunks);
      res.writeHead(upstreamRes.statusCode || 502, {
        'content-type': upstreamRes.headers['content-type'] || 'application/json',
        'content-length': responseBody.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      res.end(responseBody);
    });
  });
  upstream.setTimeout(5000, () => upstream.destroy(new Error('Collector request timed out.')));
  upstream.on('error', (error) => {
    if (!res.headersSent) json(res, 503, { error: `OTLP Collector unavailable: ${error.message}` });
  });
  upstream.end(body);
}

function makeSyntheticOtlpPayload() {
  const now = BigInt(Date.now()) * 1_000_000n;
  const attr = (key, value) => ({ key, value: { stringValue: value } });
  const gauge = (name, description, unit, value, dimensions = []) => ({
    name,
    description,
    unit,
    gauge: {
      dataPoints: [{
        timeUnixNano: String(now),
        asDouble: value,
        attributes: dimensions.map(([key, item]) => attr(key, item))
      }]
    }
  });
  const payload = {
    resourceMetrics: [{
      resource: {
        attributes: [
          attr('service.name', 'meetup-demo-ai-app'),
          attr('deployment.environment', 'local-demo'),
          { key: 'telemetry.demo', value: { boolValue: true } }
        ]
      },
      scopeMetrics: [{
        scope: { name: 'meetup-synthetic-generator', version: '1.0.0' },
        metrics: [
          gauge('demo_app_request_latency_ms', 'Synthetic AI application request latency; demo data only.', 'ms', 240 + Math.round(Math.random() * 180), [['stage', 'end-to-end']]),
          gauge('demo_model_call_latency_ms', 'Synthetic model-call latency; demo data only.', 'ms', 150 + Math.round(Math.random() * 120), [['stage', 'model']]),
          gauge('demo_atlas_query_latency_ms', 'Synthetic database query latency; demo data only, not an Atlas metric name.', 'ms', 8 + Math.round(Math.random() * 35), [['stage', 'retrieval']]),
          gauge('demo_context_tokens', 'Synthetic context token count; demo data only.', '{token}', 700 + Math.round(Math.random() * 900), [['stage', 'retrieval']]),
          gauge('demo_atlas_open_connections', 'Synthetic database connection count; demo data only, not an Atlas metric name.', '{connection}', 12 + Math.round(Math.random() * 18), [['stage', 'database']])
        ]
      }]
    }]
  };
  return JSON.stringify(payload);
}

async function sendSyntheticMetrics(res) {
  const body = makeSyntheticOtlpPayload();
  try {
    const response = await fetch(COLLECTOR_OTLP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000)
    });
    const responseText = await response.text();
    if (!response.ok) {
      json(res, 502, { error: `Collector rejected synthetic OTLP data (HTTP ${response.status}).`, details: responseText.slice(0, 500) });
      return;
    }
    json(res, 200, { ok: true, synthetic: true, message: 'Synthetic sample sent to the local Collector. These are not Atlas telemetry.' });
  } catch (error) {
    json(res, 503, { error: `OTLP Collector unavailable: ${error.message}` });
  }
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
  const filename = resolve(PUBLIC, safePath);
  if (filename !== PUBLIC && !filename.startsWith(PUBLIC + sep)) {
    json(res, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'content-type': contentTypes[extname(filename)] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff'
    });
    createReadStream(filename).pipe(res);
  } catch {
    json(res, 404, { error: 'Not found.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/healthz' && req.method === 'GET') {
    json(res, 200, { ok: true, service: 'atlas-otel-metrics-demo' });
    return;
  }

  if (pathname === '/v1/metrics') {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
      res.end('OTLP metrics endpoint expects POST.');
      return;
    }
    if (!checkReceiverAuth(req)) {
      json(res, 401, { error: 'Unauthorized OTLP request.' });
      return;
    }
    const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['application/x-protobuf', 'application/json', 'application/protobuf'].includes(mediaType)) {
      json(res, 415, { error: 'Use OTLP/HTTP Protobuf or OTLP/HTTP JSON.' });
      return;
    }
    try {
      const body = await readBody(req);
      proxyToCollector(body, req, res);
    } catch (error) {
      json(res, error.statusCode || 400, { error: error.message });
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (!checkDashboardAuth(req, res)) return;

    if (pathname === '/api/status' && req.method === 'GET') {
      try {
        const samples = await getCollectorMetrics();
        json(res, 200, {
          collectorOnline: true,
          metricSeries: samples.length,
          demoEnabled: DEMO_ENABLED,
          receiverAuthEnabled: Boolean(OTEL_AUTH_HEADER_VALUE),
          dashboardAuthEnabled: Boolean(DASHBOARD_TOKEN),
          checkedAt: new Date().toISOString()
        });
      } catch (error) {
        json(res, 200, {
          collectorOnline: false,
          metricSeries: 0,
          demoEnabled: DEMO_ENABLED,
          receiverAuthEnabled: Boolean(OTEL_AUTH_HEADER_VALUE),
          dashboardAuthEnabled: Boolean(DASHBOARD_TOKEN),
          error: error.message,
          checkedAt: new Date().toISOString()
        });
      }
      return;
    }

    if (pathname === '/api/metrics' && req.method === 'GET') {
      try {
        const samples = await getCollectorMetrics();
        json(res, 200, { samples, observedAt: new Date().toISOString() });
      } catch (error) {
        json(res, 503, { error: error.message, samples: [] });
      }
      return;
    }

    if (pathname === '/api/demo/seed' && req.method === 'POST') {
      if (!DEMO_ENABLED) {
        json(res, 404, { error: 'Synthetic generator is disabled.' });
        return;
      }
      await sendSyntheticMetrics(res);
      return;
    }

    json(res, 404, { error: 'API route not found.' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  await serveStatic(pathname, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Atlas OTel metrics demo listening on port ${PORT}`);
  console.log(`OTLP/HTTP metrics endpoint: /v1/metrics`);
  console.log(`OTLP receiver auth: ${OTEL_AUTH_HEADER_VALUE ? 'enabled' : 'disabled (local only)'}`);
});
