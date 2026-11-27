import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, publicVersion } from '../scripts/collect.mjs';
import { createGitHub } from '../scripts/github.mjs';
import { appendReports, parseReport } from '../scripts/report.mjs';
import { approvalQueue, cyclesIn, estimateFor, freshState, isSnapshot, latestFor, sourceLink } from '../src/model.mjs';
import { registry } from '../config/sources.mjs';
import { accountOf, continuationFor, conversationURL, developerWork, nextScheduledRun, scopedDevelopers, workflowBuckets } from '../src/operations.mjs';

const developer = registry[0];
const instant = '2026-11-27T18:00:00Z';
const old = '1'.repeat(40);
const current = '2'.repeat(40);
const base = '3'.repeat(40);
const url = 'https://github.com/hdog960/Mythwrought/pull/503#issuecomment-100';
const source = developer.reportSources[0];
const comment = { publisher: source.publishers[0], createdAt: instant, url };

function payload(data = {}) {
  return { schemaVersion: 1, publish: true, reportId: 'report-1', developerId: developer.id, assignmentId: developer.assignmentId,
    category: developer.category, sessionId: 'session-1', reportedAt: instant, repository: developer.repository,
    branch: developer.branch, commit: current, pull: developer.pr, outcome: 'development', ...data };
}

function markdown(data) {
  return ['<!-- mythwrought-hq-report:v1 -->', '```json', JSON.stringify(payload(data)), '```'].join('\n');
}

test('Reports require a registered identity, exact assignment, and allowlisted public fields', () => {
  assert.equal(parseReport(markdown(), developer, source, comment).commit, current);
  assert.equal(parseReport(markdown(), developer, source, { ...comment, publisher: 101 }), null);
  assert.equal(parseReport(markdown({ branch: 'elsewhere' }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ publish: false }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ privateNotes: 'internal' }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ continuation: 'Ask example@domain.com' }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ checkpoint: 'javascript:alert(1)' }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ continuation: 'x'.repeat(20_000) }), developer, source, comment), null);
  assert.equal(parseReport(markdown().replace('```json', '```xml'), developer, source, comment), null);
  assert.equal(parseReport(markdown() + '\n' + markdown(), developer, source, comment), null);
  assert.equal(sourceLink('https://github.com/another/repo'), null);
});

test('Append-only reports deduplicate re-delivery and order by observed report time', () => {
  const newer = parseReport(markdown(), developer, source, comment);
  const earlier = parseReport(markdown({ reportId: 'report-0', reportedAt: '2026-11-27T16:00:00Z' }), developer, source, comment);
  const history = appendReports([newer], [earlier, { ...newer, outcome: 'failed' }]);
  assert.equal(history.length, 2);
  assert.equal(latestFor(history, developer.assignmentId).outcome, 'development');
  assert.equal(latestFor(history, 'unrelated'), null);
});

test('Exact-commit approvals persist across unrelated reports and invalidate on a new HEAD', () => {
  const decision = { id: 'merge-1', category: 'merge', action: 'Merge candidate', reason: 'Release',
    requestedAt: instant, commit: current, state: 'requested' };
  const requested = parseReport(markdown({ decisions: [decision] }), developer, source, comment);
  const authorized = { ...decision, state: 'authorized' };
  assert.equal(parseReport(markdown({ decisions: [authorized] }), developer, source, comment), null);
  const second = parseReport(markdown({ reportId: 'report-2', decisions: [authorized] }), developer,
    { ...source, creatorAuthorizationPublishers: source.publishers }, comment);
  const newer = { ...requested, reportId: 'report-3', reportedAt: '2026-11-27T19:00:00Z', decisions: null };
  const snapshot = { developers: [{ ...developer, head: current }], reports: [requested, newer] };
  assert.equal(approvalQueue(snapshot)[0].state, 'requested');
  snapshot.reports.push(second);
  assert.deepEqual(approvalQueue(snapshot), []);
  snapshot.developers[0].head = old;
  assert.equal(approvalQueue(snapshot)[0].state, 'HEAD changed');
});

test('Unknown effort, scope completion, and circular dependencies retain their meaning', () => {
  assert.equal(estimateFor(null), null);
  const estimate = { optimistic: 0, likely: 0, conservative: 0, confidence: 'high' };
  assert.equal(estimateFor({ estimate, releaseReadiness: 'merged' }), null);
  assert.equal(estimateFor({ estimate, releaseReadiness: 'fully accepted' }), estimate);
  assert.deepEqual(cyclesIn([{ assignment: 'a', prerequisite: 'b' }, { assignment: 'b', prerequisite: 'a' }]), ['a · b']);
  assert.deepEqual(cyclesIn([{ assignment: 'a', prerequisite: 'b', state: 'resolved' }, { assignment: 'b', prerequisite: 'a' }]), []);
});

test('GitHub handles pagination, temporary failures, and ETags with bounded retries', async () => {
  let calls = 0;
  const client = createGitHub({ wait: async () => {}, previousTags: { main: '"etag"' },
    fetcher: async (url, options) => {
      calls++;
      if (url.pathname === '/branch') {
        assert.equal(options.headers['If-None-Match'], '"etag"');
        return new Response(null, { status: 304 });
      }
      if (calls === 2) return new Response(null, { status: 503 });
      return url.searchParams.has('page') ? Response.json([2]) : Response.json([1],
        { headers: { Link: '<https://api.github.com/collection?page=2>; rel="next"' } });
    } });
  assert.deepEqual(await client.request('/branch', 'main'), { unchanged: true });
  assert.deepEqual(await client.pages('/collection'), { items: [1, 2], limited: false });
  assert.equal(calls, 4);
});

test('Collector verifies report and pull HEAD, deduplicates, and preserves prior evidence during source outages', async () => {
  const github = 'https://api.github.com/repos/hdog960/Mythwrought';
  const fakePull = { number: 503, title: 'Registered draft pull', draft: true, state: 'open',
    head: { sha: current, ref: developer.branch, repo: { full_name: developer.repository } }, base: { sha: base, ref: 'main' } };
  const secondary = { ...fakePull, number: 502, head: { ...fakePull.head, ref: registry[1].branch } };
  const fakeFetch = async url => {
    const href = String(url);
    const path = new URL(href).pathname;
    if (href.startsWith('https://hdog960.github.io/')) {
      return new Response('<meta name="mythwrought-release" content="actual-version">');
    }
    if (path === '/repos/hdog960/Mythwrought-dev-hq/branches/main') return Response.json({ commit: { sha: base } });
    if (path === '/repos/hdog960/Mythwrought-dev-hq/issues/1/comments') return Response.json([]);
    assert.ok(href.startsWith(github));
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: base } });
    if (path.endsWith('/pulls/503')) return Response.json(fakePull);
    if (path.endsWith('/pulls/502')) return Response.json(secondary);
    if (path.endsWith('/pulls')) return Response.json([fakePull, secondary]);
    if (path.endsWith('/issues/503/comments')) return Response.json(
      [{ body: markdown(), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(1) },
        { body: markdown(), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(2) },
        { body: markdown({ reportId: 'unrelated', commit: old }), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(3) }]);
    if (path.includes('/compare/')) return Response.json({ status: 'diverged', merge_base_commit: { sha: base }, base_commit: { sha: old } });
    if (path.includes('/protection/')) return new Response(null, { status: 403 });
    if (path.includes('/branches/')) return Response.json({ commit: { sha: current } });
    if (path.endsWith('/check-runs')) return Response.json({ check_runs: [
      { id: 1, head_sha: current, name: 'Exact check', conclusion: 'success' },
      { id: 2, head_sha: old, name: 'Other ref', conclusion: 'failure' },
    ] });
    if (path.endsWith('/actions/runs')) {
      const filter = new URL(href).searchParams.get('status');
      if (filter === 'queued') return Response.json({ total_count: 7, workflow_runs: [
        { id: 42, name: 'Exact workflow', head_sha: current, head_branch: developer.branch, status: 'queued' },
      ] });
      if (filter === 'waiting') return new Response(null, { status: 404 });
      return Response.json({ total_count: 0, workflow_runs: [] });
    }
    return Response.json([]);
  };
  const urlFor = id => `https://github.com/hdog960/Mythwrought/pull/503#issuecomment-${id}`;
  const first = await collect({ fetcher: fakeFetch, now: new Date(instant) });
  assert.equal(first.snapshot.developers[0].head, current);
  const hqDeveloper = first.snapshot.developers.find(item => item.id === 'hq');
  assert.equal(hqDeveloper.head, base);
  assert.equal(hqDeveloper.headStatus, 'Repository branch confirmed');
  assert.equal(first.snapshot.reports.length, 1);
  assert.ok(first.snapshot.checks.every(item => item.head === current && item.mandatory === null));
  assert.equal(first.snapshot.production.version, 'actual-version');
  assert.equal(first.snapshot.workflowLoad.queued.total, 7);
  assert.equal(first.snapshot.workflowLoad.queued.runs.length, 1);
  assert.equal(first.snapshot.health.sources['workflowLoad:queued'].state, 'partial');
  assert.equal(first.snapshot.workflowLoad.in_progress.total, 0);
  assert.equal(first.snapshot.workflowLoad.waiting, null);
  assert.deepEqual(workflowBuckets(first.snapshot).map(item => item.total), [7, 0, null]);
  assert.ok(isSnapshot(first.snapshot));
  assert.equal(freshState(first.snapshot, Date.parse(instant) + 50 * 60_000), 'Stale snapshot');
  const failed = await collect({ previous: first.snapshot, state: first.state, now: new Date('2026-11-27T18:15:00Z'),
    fetcher: async () => new Response(null, { status: 404 }) });
  assert.equal(failed.canPublish, true);
  assert.equal(failed.collectionSucceeded, false);
  assert.deepEqual(failed.snapshot.reports, first.snapshot.reports);
  assert.deepEqual(failed.snapshot.pulls, first.snapshot.pulls);
  assert.deepEqual(failed.snapshot.workflowLoad, first.snapshot.workflowLoad);
  assert.equal(workflowBuckets(failed.snapshot)[0].preserved, true);
  assert.equal(failed.snapshot.health.lastSuccess, first.snapshot.health.lastSuccess);
  assert.throws(() => publicVersion('<meta name="unrelated">'));
});

test('Congestion grows with evidence, excludes deferral, and history deduplicates milestone deliveries', async () => {
  const { congestion, summarize } = await import('../src/insights.mjs');
  const report = parseReport(markdown({ newlyCompleted: ['m1'], blockers: [], decisions: [], dependencyIds: [] }),
    developer, source, comment);
  const snapshot = { developers: [{ ...developer, head: current }, { ...registry[2], status: 'Deferred per brief' }],
    reports: [report, { ...report, reportId: 'report-2', outcome: 'qualification' }],
    checks: [], dependencies: [], generatedAt: instant };
  const clear = congestion(snapshot);
  assert.equal(clear.denominator, 1);
  assert.equal(clear.score, null);
  assert.equal(clear.knownPressure, 0);
  snapshot.reports[1].blockers = [{ id: 'blocker-1', category: 'technical defect' }, { id: 'queued-1', category: 'CI waiting' }];
  assert.equal(congestion(snapshot).knownPressure, 25);
  assert.equal(summarize(snapshot, 1).meaningful.length, 1);
  assert.equal(summarize(snapshot, 1).milestones, 1);
  assert.equal(summarize(snapshot, 1, Date.parse(instant) - 1).reports.length, 0);
});

test('A revision-backed estimate reflects throughput, additional scope, and verified completion', async () => {
  const { remainingSessions, roadmapProgress } = await import('../src/estimates.mjs');
  const milestone = (id, effort, complete = false, kind = 'development') => ({ id, label: id, effort, complete, kind });
  const plan = [milestone('a', 2), milestone('b', 4), milestone('c', 6), milestone('d', 12)];
  const make = (id, index, data) => parseReport(markdown({
    reportId: id, sessionId: `work-${index}`, reportedAt: `2026-11-27T${String(10 + index).padStart(2, '0')}:00:00Z`, ...data,
  }), developer, source, comment);
  const reports = [
    make('r1', 1, { roadmap: { revision: 'r1', milestones: plan }, newlyCompleted: ['a'] }),
    make('r2', 2, { roadmapRevision: 'r1', newlyCompleted: ['b'] }),
    make('r3', 3, { roadmapRevision: 'r1', newlyCompleted: ['c'] }),
  ];
  assert.ok(reports.every(Boolean));
  assert.equal(remainingSessions(reports.slice(0, 2), developer.assignmentId), null);
  const baseline = remainingSessions(reports, developer.assignmentId);
  assert.deepEqual([baseline.optimistic, baseline.likely, baseline.conservative], [3, 3, 4]);
  reports.push(make('r4', 4, { outcome: 'administration', roadmap: {
    revision: 'r2', milestones: [...plan.map((item, index) => ({ ...item, complete: index < 3 })), milestone('e', 8)],
  } }));
  assert.equal(roadmapProgress(reports, developer.assignmentId).revision, 'r2');
  const expanded = remainingSessions(reports, developer.assignmentId);
  assert.deepEqual([expanded.optimistic, expanded.likely, expanded.conservative], [4, 5, 7]);
  reports.push(make('r5', 5, { roadmapRevision: 'r2', newlyCompleted: ['d', 'e'], releaseReadiness: 'merged' }));
  assert.equal(remainingSessions(reports, developer.assignmentId), null);
  reports.push(make('r6', 6, { roadmapRevision: 'r2', releaseReadiness: 'fully accepted', outcome: 'administration' }));
  assert.equal(remainingSessions(reports, developer.assignmentId).likely, 0);
  assert.equal(make('wrong-revision', 1, { roadmapRevision: 'r2', roadmap: { revision: 'r1', milestones: plan } }), null);
});

test('Congestion distinguishes workflow counts from verified developer execution and preserves unknowns', () => {
  const execution = { state: 'running', observedAt: instant, evidence: url };
  const reported = parseReport(markdown({ execution, continuation: 'Continue the tested checkpoint.' }), developer, source, comment);
  assert.deepEqual(reported.execution, execution);
  assert.equal(parseReport(markdown({ execution: { ...execution, observedAt: '2026-11-27T19:00:00Z' } }), developer, source, comment), null);
  const registered = { ...developer, head: current };
  const snapshot = {
    developers: [registered, registry.find(item => item.id === 'builder'), registry.find(item => item.id === 'cave')],
    reports: [reported], health: { sources: {} }, workflowLoad: { queued: { total: 1, observedAt: instant,
      runs: [{ id: 42, head: current, branch: developer.branch, status: 'queued' }] } },
  };
  const currentWork = developerWork(snapshot, undefined, Date.parse(instant));
  assert.deepEqual(currentWork.map(item => item.state), ['running', 'unknown', 'deferred']);
  assert.equal(currentWork[0].relatedWorkflow.status, 'queued');
  assert.equal(developerWork(snapshot, undefined, Date.parse(instant) + 3 * 60 * 60_000)[0].state, 'unknown');
  assert.equal(continuationFor(registered, reported), reported.continuation);
  assert.equal(continuationFor({ ...registered, head: old }, reported), null);
});

test('Developer scopes require local labels and accept only canonical conversation links', () => {
  const assignments = registry.slice(0, 2);
  const labels = { [assignments[0].id]: 'business' };
  assert.equal(accountOf(assignments[1], labels), 'unclassified');
  assert.deepEqual(scopedDevelopers(assignments, 'business', labels), [assignments[0]]);
  assert.deepEqual(scopedDevelopers(assignments, 'personal', labels), []);
  assert.equal(conversationURL('https://chatgpt.com/c/example-id'), 'https://chatgpt.com/c/example-id');
  assert.equal(conversationURL('https://chatgpt.com/g/g-example/c/example-id'), 'https://chatgpt.com/g/g-example/c/example-id');
  assert.equal(conversationURL('https://chatgpt.com/c/example-id?secret=test'), null);
  assert.equal(conversationURL('https://chatgpt.com.example.com/c/example-id'), null);
});

test('The automatic roster distinguishes recorded configuration from scheduler results', () => {
  const automatic = registry.filter(item => item.category === 'automatic');
  const verified = automatic.filter(item => item.scheduleObservedAt);
  assert.equal(automatic.length, 15);
  assert.equal(new Set(automatic.map(item => item.id)).size, 15);
  assert.equal(verified.filter(item => item.scheduleEnabled).length, 7);
  assert.equal(verified.filter(item => item.scheduleEnabled === false).length, 3);
  assert.equal(verified.filter(item => item.lastSchedulerResult).length, 5);
  assert.equal(verified.filter(item => item.lastSchedulerResult?.needsCreatorAction).length, 3);
  assert.equal(verified.filter(item => item.lastSchedulerResult?.publicOutput).length, 2);
  const states = developerWork({ developers: automatic, reports: [], health: { sources: {} } });
  assert.equal(states.filter(item => item.state === 'recorded').length, 2);
  assert.equal(states.filter(item => item.state === 'paused').length, 3);
  assert.equal(states.filter(item => item.state === 'complete').length, 0);
  const waterVisuals = automatic.find(item => item.id === 'water-world');
  assert.equal(nextScheduledRun(waterVisuals, Date.parse('2026-11-27T20:26:00Z')), '2026-11-27T20:30:00.000Z');
  assert.equal(nextScheduledRun(waterVisuals, Date.parse('2026-11-27T20:30:00Z')), '2026-11-27T21:30:00.000Z');
  assert.equal(nextScheduledRun(automatic.find(item => item.id === 'acid-physics')), null);
  assert.equal(nextScheduledRun(automatic.find(item => item.id === 'builder')), null);
});
