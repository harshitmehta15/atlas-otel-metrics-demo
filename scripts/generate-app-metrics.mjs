#!/usr/bin/env node
// Synthetic application-metric generator for rehearsals; this is not an instrumented AI app.
const endpoint = process.env.OTLP_ENDPOINT || 'http://localhost:3000/v1/metrics';
const authHeader = process.env.OTEL_AUTH_HEADER_VALUE || '';
const intervalMs = Number(process.env.INTERVAL_MS || 5000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.round(min + Math.random() * (max - min));
const stringAttr = (key, stringValue) => ({ key, value: { stringValue } });

function gauge(name, description, unit, value) {
  return {
    name, description, unit,
    gauge: { dataPoints: [{ timeUnixNano: String(BigInt(Date.now()) * 1_000_000n), asDouble: value }] }
  };
}

function payload() {
  const attrs = [
    stringAttr('service.name', 'sample-ai-chat-app'),
    stringAttr('deployment.environment', 'meetup-demo'),
    { key: 'telemetry.demo', value: { boolValue: true } }
  ];
  return {
    resourceMetrics: [{
      resource: { attributes: attrs },
      scopeMetrics: [{
        scope: { name: 'sample-ai-app-metrics-generator', version: '1.0.0' },
        metrics: [
          gauge('ai_demo_request_latency_ms', 'Synthetic end-to-end AI request latency; demo only.', 'ms', randomBetween(280, 900)),
          gauge('ai_demo_model_call_latency_ms', 'Synthetic model-call latency; demo only.', 'ms', randomBetween(180, 680)),
          gauge('ai_demo_retrieval_latency_ms', 'Synthetic retrieval latency; demo only.', 'ms', randomBetween(12, 95)),
          gauge('ai_demo_context_tokens', 'Synthetic context token count; demo only.', '{token}', randomBetween(500, 2200)),
          gauge('ai_demo_error_rate_percent', 'Synthetic application error rate; demo only.', '%', Math.random() < 0.12 ? randomBetween(1, 5) : 0)
        ]
      }]
    }]
  };
}

console.log(`Sending synthetic app metrics to ${endpoint} every ${intervalMs}ms. Ctrl+C to stop.`);
console.log('These are generated demo values, not telemetry from a real AI application.');
while (true) {
  try {
    const headers = { 'content-type': 'application/json' };
    if (authHeader) headers.authorization = authHeader;
    const response = await fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify(payload()), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) console.error(`OTLP receiver returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
    else console.log(`${new Date().toISOString()} sent app metrics`);
  } catch (error) {
    console.error(`Could not send metrics: ${error.message}`);
  }
  await sleep(intervalMs);
}
