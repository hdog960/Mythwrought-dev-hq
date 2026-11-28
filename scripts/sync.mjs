import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { collect } from './collect.mjs';
import { isSnapshot } from '../src/model.mjs';

const dir = process.env.HQ_STATE_DIR || '.local';
const snapshotFile = join(dir, 'snapshot.json');
const publicSnapshot = 'https://hdog960.github.io/Mythwrought-dev-hq/data/snapshot.json';
const publishFile = join(dir, 'publish');
const [previousLocal, state] = await Promise.all([readJSON(snapshotFile), readJSON(join(dir, 'state.json'))]);
const localValid = isSnapshot(previousLocal);
const previous = localValid ? previousLocal : await publishedSnapshot();
const { snapshot, state: nextState, canPublish } = await collect({
  previous, state: localValid ? state : null, token: process.env.HQ_GITHUB_TOKEN,
});
if (!canPublish) {
  console.error(JSON.stringify(snapshot.health.sources, null, 2));
  throw new Error('No healthy core snapshot is available. Existing Pages deployment was preserved.');
}

const lastPublished = await readJSON(join(dir, 'published.json'));
const changes = contentFingerprint(snapshot);
const publish = process.env.HQ_FORCE_PUBLISH === 'true' || lastPublished?.content !== changes ||
  Date.now() - Date.parse(lastPublished?.at ?? 0) >= 30 * 60_000;
await atomic(snapshotFile, JSON.stringify(snapshot));
await atomic(join(dir, 'state.json'), JSON.stringify(nextState));
await atomic(publishFile, publish ? 'true' : 'false');
if (publish) await atomic(join(dir, 'pending.json'), JSON.stringify({ content: changes, at: snapshot.generatedAt }));
if (process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}
console.log(JSON.stringify({ pulled: snapshot.pulls.length, issues: snapshot.issues.length, workflows: snapshot.workflows.length,
  checks: snapshot.checks.length, developers: snapshot.developers.length, reports: snapshot.reports.length,
  production: snapshot.production.version, publish, sources: snapshot.health.sources }, null, 2));

function contentFingerprint(snapshot) {
  const { generatedAt, health, production, workflowLoad, developers, schedule, ...content } = snapshot;
  const { observedAt, ...productionIdentity } = production;
  const statuses = Object.entries(health.sources).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, item.state, item.note]);
  const workload = Object.fromEntries(Object.entries(workflowLoad ?? {}).map(([status, bucket]) =>
    [status, bucket && { total: bucket.total, runs: bucket.runs }]));
  const assignments = developers.map(({ branchObservedAt, ...assignment }) => assignment);
  // Each scheduled run sees itself before completion. The heartbeat carries new
  // run links without publishing a fresh build solely because the run ID changed.
  const scheduleState = { observed: Boolean(schedule?.latest), lastConclusion: schedule?.lastCompleted?.conclusion ?? null };
  return createHash('sha256').update(JSON.stringify({ ...content, assignments, production: productionIdentity, workload, statuses, scheduleState })).digest('hex');
}

async function publishedSnapshot() {
  try {
    const response = await fetch(publicSnapshot, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const data = await response.json();
    return isSnapshot(data) ? data : null;
  } catch { return null; }
}

async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function atomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
}
