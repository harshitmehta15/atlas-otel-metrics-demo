#!/usr/bin/env node
/**
 * Bounded, read-only workload for an Atlas demo cluster with sample_mflix loaded.
 * This creates database activity; Atlas's configured OTel Metrics Sink is what
 * sends Atlas metrics to the demo receiver. This script does not send telemetry.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const uri = process.env.MONGODB_URI;
const confirmation = process.env.DEMO_WORKLOAD_CONFIRM;
const databaseName = process.env.MONGODB_DATABASE || 'sample_mflix';
const collectionName = process.env.MONGODB_COLLECTION || 'movies';
const intervalMs = Math.min(Math.max(Number(process.env.INTERVAL_MS || 4000), 1000), 30000);
const durationMinutes = Math.min(Math.max(Number(process.env.DURATION_MINUTES || 5), 1), 30);

if (!uri) {
  console.error('Set MONGODB_URI to the connection string for your dedicated demo Atlas cluster.');
  process.exit(1);
}
if (confirmation !== 'YES') {
  console.error('Safety check: set DEMO_WORKLOAD_CONFIRM=YES after confirming this is a dedicated demo cluster.');
  process.exit(1);
}
if (databaseName !== 'sample_mflix' || collectionName !== 'movies') {
  console.error('This demo workload is intentionally restricted to sample_mflix.movies.');
  process.exit(1);
}
if (!Number.isFinite(Number(process.env.INTERVAL_MS || 4000)) || !Number.isFinite(Number(process.env.DURATION_MINUTES || 5))) {
  console.error('INTERVAL_MS and DURATION_MINUTES must be numbers.');
  process.exit(1);
}

const { MongoClient } = await import('mongodb');
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  maxPoolSize: 2,
  appName: 'atlas-otel-meetup-readonly-demo'
});

let stopped = false;
process.once('SIGINT', () => { stopped = true; });
process.once('SIGTERM', () => { stopped = true; });
const startedAt = Date.now();
const deadline = startedAt + durationMinutes * 60_000;
const collection = () => client.db(databaseName).collection(collectionName);
const safeUri = uri.replace(/(mongodb(?:\+srv)?:\/\/)[^@/]+@/, '$1[credentials-redacted]@');

const operations = [
  async () => {
    const docs = await collection().find(
      { genres: 'Drama', year: { $gte: 2000 } },
      { projection: { title: 1, year: 1, genres: 1 }, maxTimeMS: 5000 }
    ).limit(12).toArray();
    return `drama sample: ${docs.length} docs`;
  },
  async () => {
    const docs = await collection().find(
      { year: { $gte: 2010, $lte: 2015 } },
      { projection: { title: 1, year: 1, 'imdb.rating': 1 }, maxTimeMS: 5000 }
    ).limit(12).toArray();
    return `2010-2015 sample: ${docs.length} docs`;
  },
  async () => {
    const docs = await collection().aggregate([
      { $match: { genres: 'Comedy', year: { $gte: 2000 } } },
      { $project: { title: 1, year: 1, genres: 1 } },
      { $limit: 12 }
    ], { maxTimeMS: 5000, allowDiskUse: false }).toArray();
    return `comedy sample: ${docs.length} docs`;
  }
];

try {
  console.log(`Connecting to ${safeUri}`);
  console.log(`Running read-only queries against ${databaseName}.${collectionName}.`);
  console.log(`Duration limit: ${durationMinutes} min; interval: ${intervalMs} ms; stop early with Ctrl+C.`);
  console.log('This script creates database activity only. Atlas must be configured separately to export metrics.');
  await client.connect();
  await client.db(databaseName).command({ ping: 1 });
  console.log('Atlas connection OK.');

  let cycle = 0;
  while (!stopped && Date.now() < deadline) {
    for (const operation of operations) {
      if (stopped || Date.now() >= deadline) break;
      const result = await operation();
      cycle += 1;
      console.log(`${new Date().toISOString()} read ${cycle}: ${result}`);
    }
    if (!stopped && Date.now() < deadline) await sleep(intervalMs);
  }
  console.log(`Finished after ${Math.round((Date.now() - startedAt) / 1000)}s; issued ${cycle} bounded read operations.`);
} catch (error) {
  console.error(`Workload stopped: ${error.message}`);
  if (error.code === 18 || error.codeName === 'AuthenticationFailed') {
    console.error('Check the Atlas database user, password, and network access list.');
  } else if (error.code === 26 || error.codeName === 'NamespaceNotFound') {
    console.error('Load Atlas sample data and confirm sample_mflix.movies exists.');
  }
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
