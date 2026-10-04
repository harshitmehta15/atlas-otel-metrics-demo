import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrometheusText } from '../lib/prometheus.js';

test('parses metric type, value, and labels from Prometheus exposition', () => {
  const input = [
    '# HELP demo_latency Latency in milliseconds',
    '# TYPE demo_latency gauge',
    'demo_latency{service_name="chat-api",route="/ask"} 42.5 1730000000000',
    'requests_total 7'
  ].join('\n');
  const result = parsePrometheusText(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    name: 'demo_latency', value: 42.5, type: 'gauge',
    labels: { service_name: 'chat-api', route: '/ask' }
  });
  assert.equal(result[1].name, 'requests_total');
  assert.equal(result[1].type, 'untyped');
  assert.equal(result[1].value, 7);
});

test('parses escaped quotes in label values and skips comments/non-numeric samples', () => {
  const result = parsePrometheusText([
    '# TYPE demo_info gauge',
    'demo_info{note="say \\\"hi\\\""} 1',
    'demo_nan NaN'
  ].join('\n'));
  assert.equal(result.length, 1);
  assert.equal(result[0].labels.note, 'say "hi"');
});
