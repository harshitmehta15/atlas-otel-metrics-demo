/** Parse the Prometheus text exposition format emitted by the OTel Collector. */
export function parsePrometheusText(text) {
  const types = new Map();
  const samples = [];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const typeMatch = line.match(/^#\s+TYPE\s+([^\s]+)\s+([^\s]+)/);
    if (typeMatch) {
      types.set(typeMatch[1], typeMatch[2]);
      continue;
    }
    if (line.startsWith('#')) continue;

    // Split sample name/labels from the value without breaking braces in quoted labels.
    let inQuotes = false;
    let escaped = false;
    let braceDepth = 0;
    let splitAt = -1;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inQuotes) { escaped = true; continue; }
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && ch === '{') braceDepth += 1;
      if (!inQuotes && ch === '}') braceDepth -= 1;
      if (!inQuotes && braceDepth === 0 && /\s/.test(ch)) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) continue;

    const identity = line.slice(0, splitAt);
    const rest = line.slice(splitAt).trim().split(/\s+/);
    const value = Number(rest[0]);
    if (!Number.isFinite(value)) continue;

    const braceAt = identity.indexOf('{');
    const name = braceAt < 0 ? identity : identity.slice(0, braceAt);
    if (!name) continue;
    const labels = {};
    if (braceAt >= 0 && identity.endsWith('}')) {
      const labelText = identity.slice(braceAt + 1, -1);
      const labelPattern = /([^,=\s]+)="((?:\\.|[^"\\])*)"(?:,|$)/g;
      let match;
      while ((match = labelPattern.exec(labelText)) !== null) {
        labels[match[1]] = match[2]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }
    samples.push({ name, value, type: types.get(name) || 'untyped', labels });
  }
  return samples;
}
