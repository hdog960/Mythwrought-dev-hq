import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHandoffs } from '../scripts/checkpoints.mjs';
import { regionalHandoffs, registry } from '../config/sources.mjs';
import { liveRefreshInterval, readLiveGitHub } from '../src/live-github.mjs';
import { handoffFrom, prerequisiteName } from '../src/model.mjs';
import { assignmentStatus, continuationFor } from '../src/operations.mjs';
import { creatorActions } from '../src/command-center.mjs';
import { releaseOverview } from '../src/releases.mjs';

const head = 'a'.repeat(40);
const observed = '2026-11-28T13:00:00Z';
const source = 'https://github.com/hdog960/Mythwrought/issues/510';
const receiving = registry.find(item => item.id === 'world-ascension');
const owner = { ...receiving.ownershipSource, assignmentState: 'assigned', source, reportedAt: observed };

test('Verified handoffs keep historical records and five independent prerequisites', async () => {
  const ownership = new Map([[receiving.assignmentId, owner]]);
  const handoffs = await collectHandoffs(registry, regionalHandoffs, ownership, async route => {
    const branch = decodeURIComponent(route.split('/').at(-1));
    if (branch.includes('frostbound')) throw new Error('unavailable');
    return { name: branch, commit: { sha: head } };
  });
  assert.equal(handoffs.length, 5);
  const snapshot = { handoffs, developers: registry.map(item => item === receiving ? { ...receiving, head, ownership: owner } : item) };
  assert.equal(handoffFrom(snapshot, 'snow-v1').head, null);
  const cave = handoffFrom(snapshot, 'cave-v1');
  assert.equal(cave.previous.length, 2);
  assert.match(cave.protectedPull, /\/pull\/367$/);
  assert.equal(cave.head, head);
  assert.equal(prerequisiteName(snapshot, 'cave-v1'), 'Living Underworld · Business Codex');
  assert.equal(assignmentStatus(snapshot, registry.find(item => item.id === 'cave')).label, 'Handed off');
  assert.equal(continuationFor(snapshot.developers.find(item => item.id === 'cave'), null, snapshot), null);
  assert.equal(continuationFor({ ...receiving, head, publicCheckpoint: { commit: head, observedHead: head, source } }, null, snapshot), null);
  const none = await collectHandoffs(registry, regionalHandoffs, new Map(), () => assert.fail('read without creator record'));
  assert.deepEqual(none, []);
});

test('Direct GitHub checks are anonymous and keep unavailable values distinct from zero', async () => {
  const now = () => Date.parse(observed);
  const reads = [];
  const result = await readLiveGitHub({ now, fetcher: async (raw, options) => {
    const url = new URL(raw);
    reads.push(url.pathname);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, undefined);
    if (url.pathname.endsWith('/main')) return Response.json({ ref: 'refs/heads/main', object: { sha: head } });
    const state = url.searchParams.get('status');
    if (state === 'waiting') return new Response(null, { status: 429, headers: { 'Retry-After': '1200' } });
    if (state === 'queued') return Response.json({ total_count: 0, workflow_runs: [] });
    return Response.json({ total_count: -1, workflow_runs: [] });
  } });
  assert.equal(reads.length, 4);
  assert.equal(result.mainHead, head);
  assert.deepEqual(result.workflowCounts, { queued: 0, in_progress: null, waiting: null });
  assert.ok(result.retryAt >= now() + liveRefreshInterval);
  assert.equal(result.observedAt, '2026-11-28T13:00:00.000Z');
});

test('A release embargo holds authorization while allowing verified development', () => {
  const developer = { ...registry.find(item => item.id === 'beasts'), head, reportFeedState: 'ok' };
  const report = {
    assignmentId: developer.assignmentId, commit: head, reportId: 'work', source: developer.source,
    reportedAt: observed, execution: { state: 'running', observedAt: observed, evidence: developer.source },
  };
  const pull = { number: developer.pr, head, state: 'open', headRepositoryMatches: true, branch: developer.branch, source: developer.source };
  const snapshot = { developers: [developer], reports: [report], checks: [], pulls: [pull], dependencies: [], directives: [],
    production: {}, deployments: [], health: { lastAttempt: observed, lastSuccess: observed, sources: {} } };
  assert.equal(assignmentStatus(snapshot, developer, Date.parse(observed)).label, 'Developing');
  report.decisions = [{ id: 'merge', category: 'merge', commit: head, state: 'requested', requestedAt: observed, action: 'Review merge' }];
  assert.equal(creatorActions(snapshot)[0].approvalHeld, true);
  assert.equal(releaseOverview(snapshot).candidates[0].stage, 'Held by creator directive');
});
