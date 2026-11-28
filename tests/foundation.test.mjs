import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, publicVersion } from '../scripts/collect.mjs';
import { createGitHub } from '../scripts/github.mjs';
import { appendReports, parseReport } from '../scripts/report.mjs';
import { approvalQueue, cyclesIn, estimateFor, freshState, isSnapshot, latestFor, sourceLink } from '../src/model.mjs';
import { registry } from '../config/sources.mjs';
import { accountOf, assignmentStatus, continuationFor, conversationURL, developerWork, nextScheduledRun, scopedDevelopers, workflowBuckets } from '../src/operations.mjs';
import { creatorActions } from '../src/command-center.mjs';
import { collectOwnership, readCheckpoint } from '../scripts/checkpoints.mjs';
import { createHash } from 'node:crypto';

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

test('Workspace ownership requires a creator publisher and overrides local account labels', () => {
  const ownership = { workspace: 'business', assignmentState: 'assigned', owner: 'Creative Developer', exclusiveScopes: ['world-creation'] };
  const parsed = parseReport(markdown({ ownership }), developer, source, comment);
  assert.deepEqual(parsed.ownership, ownership);
  assert.equal(parseReport(markdown({ ownership }), developer, { ...source, creatorOwnershipPublishers: [] }, comment), null);
  assert.equal(parseReport(markdown({ ownership: { ...ownership, assignmentState: 'unassigned' } }), developer, source, comment), null);
  assert.equal(parseReport(markdown({ ownership: { ...ownership, exclusiveScopes: ['world-creation', 'world-creation'] } }), developer, source, comment), null);
  assert.equal(accountOf({ ...developer, ownership }, { [developer.id]: 'personal' }), 'business');
});

test('Public checkpoints and issue ownership require the enrolled source and exact GitHub evidence', async () => {
  const spec = { path: 'docs/example/checkpoint.md' };
  const assignment = { ...developer, head: current };
  const revision = { sha: old, commit: { committer: { date: instant } } };
  const reads = [];
  const file = await readCheckpoint(assignment, spec, null, async route => {
    reads.push(route);
    return route.includes('/commits?') ? [revision] : { type: 'file', path: spec.path, sha: base };
  });
  assert.match(reads[0], new RegExp(current));
  assert.match(reads[1], new RegExp(old));
  assert.equal(file.observedHead, current);
  assert.equal(file.commit, old);
  assert.match(file.source, new RegExp(old));
  assert.equal(await readCheckpoint(assignment, spec, file, () => assert.fail('immutable file fetched twice')), file);
  await assert.rejects(readCheckpoint(assignment, spec, null, async () => []), /revision unavailable/);
  const directory = { directory: 'docs/example', pattern: /^SESSION_(\d+)\.md$/ };
  const docs = ['SESSION_9.md', 'SESSION_11.md', 'script.mjs'].map(name => ({
    name, type: 'file', path: `${directory.directory}/${name}`,
  }));
  const latest = await readCheckpoint(assignment, directory, null, async route => route.includes('/commits?') ? [revision] :
    route.includes('/SESSION_11.md') ? { type: 'file', path: docs[1].path, sha: base } : docs);
  assert.match(latest.source, /SESSION_11\.md$/);
  await assert.rejects(readCheckpoint(assignment, directory, null, async () => [...docs, docs[1]]), /ambiguous/);
  const marker = { comment: 100, commit: old };
  const ownerComment = { id: 100, html_url: url, user: { id: comment.publisher }, author_association: 'OWNER',
    body: `Observed ${old}.`, updated_at: instant };
  assert.equal((await readCheckpoint(assignment, marker, null, async route => route.includes('/compare/') ?
    { status: 'ahead', merge_base_commit: { sha: old } } : ownerComment)).source, url);
  await assert.rejects(readCheckpoint(assignment, marker, null, async () => ({ ...ownerComment, html_url: url + '1' })), /comment unavailable/);
  await assert.rejects(readCheckpoint(assignment, marker, null, async route => route.includes('/compare/') ?
    { status: 'diverged' } : ownerComment), /outside/);
  const body = 'Creator assigned a lane.';
  const created = { number: 511, state: 'open', user: { id: comment.publisher }, author_association: 'OWNER', body, created_at: instant };
  const enrollment = { ...assignment, ownershipSource: { issue: 511, workspace: 'business', owner: 'Owner', exclusiveScopes: [],
    digest: createHash('sha256').update(body).digest('hex') } };
  assert.equal((await collectOwnership([enrollment], async () => created)).get(assignment.assignmentId).workspace, 'business');
  assert.equal((await collectOwnership([enrollment], async () => ({ ...created, body: 'Edited' }))).get(assignment.assignmentId), null);
});

test('Exact-commit approvals persist across unrelated reports and invalidate on a new HEAD', () => {
  const decision = { id: 'merge-1', category: 'merge', action: 'Merge candidate', reason: 'Release',
    requestedAt: instant, commit: current, state: 'requested' };
  const requested = parseReport(markdown({ decisions: [decision] }), developer, source, comment);
  const authorized = { ...decision, state: 'authorized' };
  assert.equal(parseReport(markdown({ decisions: [authorized] }), developer,
    { ...source, creatorAuthorizationPublishers: [] }, comment), null);
  const second = parseReport(markdown({ reportId: 'report-2', decisions: [authorized] }), developer, source, comment);
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
  const secondary = { ...fakePull, number: 502, draft: false, head: { ...fakePull.head, ref: registry[1].branch } };
  let partialOutage = false;
  const fakeFetch = async url => {
    const href = String(url);
    const path = new URL(href).pathname;
    if (href.startsWith('https://hdog960.github.io/')) {
      return new Response('<meta name="mythwrought-release" content="actual-version">');
    }
    if (path === '/repos/hdog960/Mythwrought-dev-hq/branches/main') return Response.json({ commit: { sha: base } });
    if (path === '/repos/hdog960/Mythwrought-dev-hq/issues/1/comments') return Response.json([]);
    if (path === '/repos/hdog960/Mythwrought-dev-hq/actions/workflows/hq-pages.yml/runs') return Response.json({ workflow_runs: [], total_count: 0 });
    assert.ok(href.startsWith(github));
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: base } });
    if (path.endsWith('/pulls/503')) return partialOutage ? new Response(null, { status: 404 }) : Response.json(fakePull);
    if (path.endsWith('/pulls/502')) return Response.json(secondary);
    if (path.endsWith('/pulls/502/requested_reviewers')) return Response.json({ users: [{}], teams: [{}] });
    if (path.endsWith('/pulls')) return Response.json([fakePull, secondary]);
    if (path.endsWith('/issues/503/comments')) return Response.json(
      [{ body: markdown(), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(1) },
        { body: markdown(), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(2) },
        { body: markdown({ reportId: 'unrelated', commit: old }), user: { id: comment.publisher }, created_at: instant, html_url: urlFor(3) }]);
    if (path.includes('/compare/')) return Response.json({ status: 'diverged', merge_base_commit: { sha: base }, base_commit: { sha: old } });
    if (path.includes('/protection/')) return new Response(null, { status: 403 });
    if (path.endsWith('/rules/branches/main')) return Response.json(partialOutage ? [
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Exact check', integration_id: 17 }] } },
    ] : []);
    if (partialOutage && decodeURIComponent(path).endsWith('/branches/' + developer.branch)) return new Response(null, { status: 404 });
    if (path.includes('/branches/')) return Response.json({ commit: { sha: current } });
    if (path.endsWith('/check-runs')) return Response.json({ check_runs: [
      { id: 1, head_sha: current, name: 'Exact check', conclusion: 'success', app: { id: 17 } },
      { id: 2, head_sha: old, name: 'Other ref', conclusion: 'failure' },
      { id: 3, head_sha: current, name: 'Exact check', conclusion: 'failure', app: { id: 18 } },
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
  assert.equal(first.snapshot.developers[0].review, null);
  assert.equal(first.snapshot.developers[1].review.requested, 2);
  assert.equal(first.snapshot.developers[1].requiredGate.state, 'unavailable');
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
  assert.deepEqual(first.snapshot.schedule, { latest: null });
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
  assert.equal(failed.snapshot.health.sources.reports.state, 'error');
  assert.throws(() => publicVersion('<meta name="unrelated">'));
  partialOutage = true;
  const partial = await collect({ previous: first.snapshot, state: first.state, fetcher: fakeFetch,
    now: new Date('2026-11-27T18:25:00Z') });
  assert.equal(partial.snapshot.health.sources.registeredBranches.state, 'partial');
  assert.equal(partial.snapshot.developers[0].head, null);
  assert.equal(partial.snapshot.developers[0].branchHead, current);
  assert.equal(partial.snapshot.developers[0].branchObservedAt, first.snapshot.generatedAt);
  assert.equal(partial.snapshot.pulls.find(item => item.number === 503).head, current);
  assert.equal(partial.snapshot.developers[1].branchObservedAt, partial.snapshot.generatedAt);
  assert.equal(partial.snapshot.checks.find(item => item.id === 1).mandatory, true);
  assert.equal(partial.snapshot.checks.find(item => item.id === 3).mandatory, null);
});

test('Creator actions group confirmed conflicts and current failures and separate missing evidence', () => {
  const evidence = 'https://github.com/hdog960/Mythwrought/actions/runs/100';
  const pending = { id: 'need-merge', category: 'merge', action: 'Review merge', reason: 'Candidate', commit: current,
    requestedAt: instant, state: 'requested' };
  const report = parseReport(markdown({
    decisions: [pending, { ...pending, id: 'duplicate-merge' }],
    blockers: [{ id: 'required-failure', category: 'required CI failure', description: 'Gate failed', detectedAt: instant, evidence },
      { id: 'waiting', category: 'CI waiting', description: 'Workflow pending', detectedAt: instant, evidence }],
  }), developer, source, comment);
  const ownership = { workspace: 'personal', assignmentState: 'assigned', owner: 'First owner',
    exclusiveScopes: ['world-creation', 'save-schema'], source: url, reportedAt: instant };
  const [first, second, unassigned, unknown] = [
    { ...developer, head: current, ownership },
    { ...registry[1], head: current, ownership: { ...ownership, workspace: 'business', owner: 'Second owner',
      source: registry[1].source } },
    { ...registry[2], ownership: { ...ownership, assignmentState: 'unassigned', owner: null, exclusiveScopes: [] } },
    registry[3],
  ];
  const pull = { number: first.pr, head: current, headRepositoryMatches: true, state: 'open', source: first.source };
  const check = { number: first.pr, head: current, status: 'completed', mandatory: true,
    conclusion: 'failure', title: 'Required check', source: evidence };
  const snapshot = { developers: [first, second, unassigned, unknown], reports: [report], pulls: [pull], directives: [], dependencies: [],
    checks: [check, { ...check, head: old, title: 'Old failure' }, { ...check, mandatory: null, title: 'Unknown gate' }] };
  const queue = creatorActions(snapshot);
  assert.deepEqual(queue.map(item => item.kind), ['ownership', 'qualification', 'merge', 'unassigned']);
  assert.equal(queue.find(item => item.kind === 'merge').approvalHeld, true);
  assert.equal(queue[0].developers.length, 2);
  assert.match(queue[0].detail, /world-creation.*save-schema/);
  assert.deepEqual(creatorActions(snapshot, [second]).map(item => item.kind), ['ownership']);
  first.head = old;
  assert.deepEqual(creatorActions(snapshot).map(item => item.kind), ['ownership', 'unassigned']);
});

test('Developer state needs timely direct execution, an exact-commit checkpoint or a sourced dependency', () => {
  const now = Date.parse(instant);
  const first = { ...developer, head: current };
  const report = parseReport(markdown({ nextObjective: 'Integrate update', blockers: [] }), developer, source, comment);
  const snapshot = { developers: [first], reports: [report], pulls: [], directives: [], dependencies: [], checks: [],
    health: { lastAttempt: instant, lastSuccess: instant, sources: {} } };
  assert.equal(assignmentStatus(snapshot, first, now).label, 'Ready to continue');
  snapshot.dependencies.push({ id: 'requires-build', assignment: first.assignmentId, state: 'required', scope: 'Shared build', source: url });
  report.dependencyIds = ['requires-build'];
  assert.equal(assignmentStatus(snapshot, first, now).label, 'Awaiting another developer');
  report.dependencyIds = null;
  report.execution = { state: 'running', observedAt: instant, evidence: url };
  assert.equal(assignmentStatus(snapshot, first, now).label, 'Developing');
  assert.equal(assignmentStatus(snapshot, first, now + 46 * 60_000).label, 'Status unknown');
  first.reportFeedState = 'unavailable';
  assert.equal(assignmentStatus(snapshot, first, now).label, 'Status unknown');
});

test('Congestion exposes evidence bounds, separates caps from failures, and scopes the queue', async () => {
  const { congestion, summarize } = await import('../src/insights.mjs');
  const report = parseReport(markdown({ newlyCompleted: ['m1'], blockers: [], decisions: [], dependencyIds: [], releaseReadiness: 'development' }),
    developer, source, comment);
  const registered = { ...developer, head: current, reportFeedState: 'ok', review: { head: current, requested: 2, source: url },
    ownership: { workspace: 'personal', assignmentState: 'assigned', owner: 'Owner', exclusiveScopes: [], source: url } };
  const pull = { head: current, number: registered.pr, headRepositoryMatches: true, state: 'open', draft: false, source: url };
  const snapshot = { developers: [registered, { ...registry[2], status: 'Deferred per brief' }],
    reports: [report, { ...report, reportId: 'report-2', outcome: 'qualification' }],
    checks: [], dependencies: [], directives: [], pulls: [pull], generatedAt: instant };
  const partial = congestion(snapshot);
  assert.equal(partial.denominator, 1);
  assert.equal(partial.score, null);
  assert.equal(partial.coverage, 80);
  assert.deepEqual([partial.lower, partial.upper], [10, 30]);
  snapshot.reports[1].blockers = [{ id: 'blocker-1', category: 'technical defect', description: 'Investigate', evidence: url },
    { id: 'queued-1', category: 'CI waiting' }];
  registered.requiredGate = { head: current, state: 'pending', source: url };
  assert.equal(congestion(snapshot).score, 50);
  assert.equal(congestion(snapshot, []).score, null);
  pull.draft = true;
  const draft = congestion(snapshot);
  assert.equal(draft.score, 40);
  assert.equal(draft.candidates[0].pull.draft, true);
  registered.requiredGate.head = old;
  assert.equal(congestion(snapshot).score, null);
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
  assert.equal(developerWork(snapshot, [{ ...registered, head: old }], Date.parse(instant))[0].state, 'unknown');
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
