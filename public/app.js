const POLL_MS = 5000;
const $ = (id) => document.getElementById(id);
const seriesCount = $('series-count');
const collectorState = $('collector-state');
const updated = $('last-updated');
const receiverBadge = $('receiver-badge');
const notice = $('data-notice');
const metricList = $('metric-list');
const metricSelect = $('metric-select');
const chart = $('chart');
const chartEmpty = $('chart-empty');
const seedButton = $('seed-button');
const seedResult = $('seed-result');
const tokenInput = $('dashboard-token');
const accessPanel = $('access-panel');
let accessToken = sessionStorage.getItem('dashboardToken') || '';
let metricHistory = new Map();
let knownNames = [];
let demoEnabled = false;
let hasSyntheticData = false;

function requestHeaders(extra = {}) {
  return accessToken ? { ...extra, 'x-dashboard-token': accessToken } : extra;
}
function pretty(value) {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 10000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return value.toPrecision(3);
}
function setReceiver(ok, text) {
  receiverBadge.className = `status-pill ${ok ? 'status-online' : 'status-error'}`;
  receiverBadge.querySelector('span').textContent = text;
  collectorState.textContent = ok ? 'Online' : 'Offline';
  collectorState.style.color = ok ? '#00684a' : '#b14444';
}
function setNotice(kind, text) {
  notice.className = `notice ${kind || ''}`;
  notice.lastElementChild.textContent = text;
}
function renderMetrics(samples, observedAt) {
  seriesCount.textContent = samples.length.toLocaleString();
  updated.textContent = `Updated ${new Date(observedAt).toLocaleTimeString()}`;
  const names = [...new Set(samples.map((sample) => sample.name))].sort();
  knownNames = names;

  for (const sample of samples) {
    if (sample.name.startsWith('demo_') || sample.name.includes('_demo_') || sample.labels?.telemetry_demo === 'true') hasSyntheticData = true;
    const history = metricHistory.get(sample.name) || [];
    history.push({ value: sample.value, at: Date.now() });
    metricHistory.set(sample.name, history.slice(-36));
  }
  for (const name of [...metricHistory.keys()]) {
    if (!names.includes(name)) metricHistory.delete(name);
  }

  const selected = metricSelect.value;
  metricSelect.replaceChildren();
  if (!names.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Waiting for metrics…';
    metricSelect.append(option);
    chart.classList.add('hidden');
    chartEmpty.classList.remove('hidden');
    metricList.innerHTML = '<div class="empty-list">No series received yet.</div>';
    setNotice('', 'Waiting for metric samples. Configure an OTLP sender or generate clearly labeled synthetic data.');
    return;
  }

  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    metricSelect.append(option);
  }
  metricSelect.value = names.includes(selected) ? selected : names[0];
  chart.classList.remove('hidden');
  chartEmpty.classList.add('hidden');
  renderChart(metricSelect.value);

  metricList.replaceChildren();
  for (const sample of samples.slice(0, 60)) {
    const card = document.createElement('article');
    card.className = 'metric-card';
    const top = document.createElement('div');
    top.className = 'metric-top';
    const kind = document.createElement('span');
    kind.className = 'metric-type';
    kind.textContent = sample.type || 'metric';
    const dimensions = document.createElement('span');
    dimensions.className = 'muted';
    dimensions.textContent = `${Object.keys(sample.labels || {}).length} labels hidden`;
    top.append(kind, dimensions);
    const title = document.createElement('h3');
    title.textContent = sample.name;
    const value = document.createElement('span');
    value.className = 'metric-value';
    value.textContent = pretty(sample.value);
    const foot = document.createElement('div');
    foot.className = 'metric-sub';
    const synthetic = sample.name.startsWith('demo_') || sample.name.includes('_demo_') || sample.labels?.telemetry_demo === 'true';
    const serviceName = sample.labels?.service_name || sample.labels?.['service.name'];
    foot.textContent = synthetic ? `Synthetic demo series${serviceName ? ` · ${serviceName}` : ''} — not Atlas telemetry` : `OTLP series${serviceName ? ` · service ${serviceName}` : ''}`;
    card.append(top, title, value, foot);
    metricList.append(card);
  }
  if (samples.length > 60) {
    const more = document.createElement('div');
    more.className = 'empty-list';
    more.textContent = `${samples.length - 60} additional samples not shown.`;
    metricList.append(more);
  }
  if (hasSyntheticData) {
    setNotice('synthetic', 'Synthetic demo values are present. They validate the OTLP dashboard path; they are not Atlas measurements.');
  } else {
    setNotice('live', 'Metric samples are arriving. Atlas metrics and application metrics are distinct signals; compare them in the same time window.');
  }
}

function renderChart(name) {
  const history = metricHistory.get(name) || [];
  if (!history.length) return;
  const width = 900;
  const height = 250;
  const left = 50;
  const right = 18;
  const top = 20;
  const bottom = 36;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const values = history.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= Math.max(Math.abs(min) * 0.1, 1); max += Math.max(Math.abs(max) * 0.1, 1); }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  const x = (index) => left + (history.length === 1 ? plotW / 2 : (index / (history.length - 1)) * plotW);
  const y = (value) => top + ((max - value) / (max - min)) * plotH;
  chart.replaceChildren();
  for (let i = 0; i < 4; i += 1) {
    const gy = top + (plotH * i) / 3;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', left); line.setAttribute('x2', width - right);
    line.setAttribute('y1', gy); line.setAttribute('y2', gy);
    line.setAttribute('class', 'grid-line'); chart.append(line);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', 0); label.setAttribute('y', gy + 4); label.setAttribute('class', 'axis-label');
    label.textContent = pretty(max - ((max - min) * i) / 3); chart.append(label);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'chart-line');
  path.setAttribute('d', history.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.value)}`).join(' '));
  chart.append(path);
  history.forEach((point, index) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x(index)); circle.setAttribute('cy', y(point.value)); circle.setAttribute('r', 4); circle.setAttribute('class', 'chart-point');
    chart.append(circle);
  });
}

async function refresh() {
  try {
    const statusResponse = await fetch('/api/status', { headers: requestHeaders(), cache: 'no-store' });
    if (statusResponse.status === 401) { accessPanel.classList.remove('hidden'); setReceiver(false, 'Dashboard locked'); return; }
    if (!statusResponse.ok) throw new Error(`Status request failed (${statusResponse.status})`);
    const status = await statusResponse.json();
    accessPanel.classList.add('hidden');
    demoEnabled = Boolean(status.demoEnabled);
    seedButton.classList.toggle('hidden', !demoEnabled);
    setReceiver(Boolean(status.collectorOnline), status.collectorOnline ? 'Collector online' : 'Collector offline');
    if (!status.collectorOnline) throw new Error(status.error || 'Collector unavailable');
    const response = await fetch('/api/metrics', { headers: requestHeaders(), cache: 'no-store' });
    if (response.status === 401) { accessPanel.classList.remove('hidden'); setReceiver(false, 'Dashboard locked'); return; }
    if (!response.ok) throw new Error(`Metric request failed (${response.status})`);
    const payload = await response.json();
    renderMetrics(payload.samples || [], payload.observedAt || new Date().toISOString());
  } catch (error) {
    setReceiver(false, 'Collector unavailable');
    setNotice('', `Cannot read Collector metrics: ${error.message}. Start the local Docker demo or check the deployed service.`);
    updated.textContent = 'Not connected';
  }
}

$('save-token').addEventListener('click', () => {
  accessToken = tokenInput.value.trim();
  sessionStorage.setItem('dashboardToken', accessToken);
  refresh();
});
tokenInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('save-token').click(); });
$('refresh-button').addEventListener('click', refresh);
metricSelect.addEventListener('change', () => renderChart(metricSelect.value));
seedButton.addEventListener('click', async () => {
  seedButton.disabled = true;
  seedResult.textContent = 'Sending synthetic OTLP sample…';
  try {
    const response = await fetch('/api/demo/seed', { method: 'POST', headers: requestHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    seedResult.textContent = result.message;
    hasSyntheticData = true;
    await refresh();
  } catch (error) {
    seedResult.textContent = error.message;
  } finally {
    seedButton.disabled = false;
  }
});
refresh();
setInterval(refresh, POLL_MS);
