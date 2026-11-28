import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry, productionURL } from '../config/sources.mjs';
import { qualificationInventory, reconcileQualification } from '../scripts/qualification.mjs';
import { matchProduction, observeProduction } from '../scripts/publication.mjs';
import { releaseOverview } from '../src/releases.mjs';
import { continuationFor } from '../src/operations.mjs';

const [registered] = registry;
const head = 'a'.repeat(40);
const merge = 'b'.repeat(40);
const old = 'c'.repeat(40);
const instant = '2026-11-28T01:00:00Z';
const source = registered.source;
const candidate = { number: registered.pr, branch: registered.branch, head, headRepositoryMatches: true, source };
const response = items => ({ status: 'fulfilled', value: { items, limited: false } });

test('Qualification binds legacy contexts to the exact SHA and reconciles same-name check runs', async () => {
  const check = { id: 1, name: 'gate', head_sha: head, status: 'completed', conclusion: 'success', app: { id: 10 } };
  const legacy = { id: 2, context: 'gate', state: 'error', updated_at: instant };
  const requirement = { rules: [{ context: 'gate' }], complete: true };
  const failed = reconcileQualification(candidate, requirement, [response([check]), response([legacy])]);
  assert.equal(failed.gate.state, 'failed');
  assert.equal(failed.checks.find(item => item.kind === 'status').mandatory, true);
  const succeeded = reconcileQualification(candidate, requirement, [response([check]), response([
    legacy, { ...legacy, id: 4, state: 'success' },
  ])]);
  assert.equal(succeeded.gate.state, 'clear');
  assert.equal(succeeded.checks.filter(item => item.kind === 'status').length, 1);
  const appScoped = reconcileQualification(candidate, { ...requirement, rules: [{ context: 'gate', app_id: 10 }] },
    [response([check]), response([legacy])]);
  assert.equal(appScoped.checks.find(item => item.kind === 'status').mandatory, null);
  assert.equal(appScoped.gate.state, 'unavailable');
  const unavailable = reconcileQualification(candidate, requirement, [response([check]), { status: 'rejected' }], failed.checks);
  assert.equal(unavailable.gate.state, 'unavailable');
  assert.equal(unavailable.checks.find(item => item.kind === 'status').preserved, true);
  const inventory = await qualificationInventory(head, async (route, { unwrap }) => {
    if (route.includes('check-runs')) return { items: unwrap({ check_runs: [check] }), limited: false };
    const items = unwrap({ sha: old, statuses: [legacy] });
    if (!Array.isArray(items)) throw new Error('wrong SHA');
    return { items, limited: false };
  });
  assert.equal(inventory[1].status, 'rejected');
});

test('A public match requires live HTML bytes, the latest deployment, and unique evidence', async () => {
  const production = await observeProduction(async () => new Response('<meta name="mythwrought-release" content="expected-v1">'), instant);
  const active = { id: 1, head: merge, state: 'success', target: productionURL, updatedAt: instant, source };
  const historical = { ...active, id: 2, head: old, updatedAt: '2026-11-27T01:00:00Z' };
  const response = sha => ({ type: 'file', path: 'index.html', sha });
  const match = await matchProduction(production, [active, historical], async route =>
    response(route.endsWith(merge) ? production.indexBlob : old));
  assert.equal(match.head, merge);
  assert.match(match.commitSource, new RegExp(merge));
  assert.equal(await matchProduction(production, [active, historical], async () => response(production.indexBlob)), null);
  assert.equal(await matchProduction(production, [active, historical], async route =>
    response(route.endsWith(old) ? production.indexBlob : head)), null);
});

test('Release tracking keeps creator approval, historical deployment and physical iPhone acceptance distinct', () => {
  const assignment = { ...registered, head, reportFeedState: 'ok' };
  const pull = { ...candidate, state: 'merged', mergeCommit: old };
  const snapshot = {
    developers: [assignment], pulls: [pull], reports: [], production: { version: 'expected-v1' }, deployments: [
      { id: 4, head: old, state: 'inactive', lastSuccessAt: instant, source },
    ],
    publication: { head: merge, deployedAt: instant },
    releaseRecords: [{ assignmentId: assignment.assignmentId, pull: pull.number, kind: 'authorization', commit: head, source,
      recordedAt: instant }],
  };
  assert.equal(releaseOverview(snapshot).candidates[0].stage, 'Previously deployed');
  assert.equal(releaseOverview(snapshot).candidates[0].approval.source, source);
  const observedAt = '2026-11-28T01:10:00Z';
  const report = { assignmentId: assignment.assignmentId, repository: assignment.repository, source,
    reportedAt: observedAt, reportId: 'receipt', commit: head, releaseReadiness: 'fully accepted',
    physicalAcceptance: { commit: old, device: 'iPhone', result: 'passed', final: true, version: 'expected-v1', observedAt } };
  snapshot.reports.push(report);
  assert.equal(releaseOverview(snapshot).liveStage, 'Physical iPhone acceptance pending');
  report.physicalAcceptance.commit = merge;
  assert.equal(releaseOverview(snapshot).liveStage, 'Fully accepted release');
  report.physicalAcceptance.final = false;
  assert.equal(releaseOverview(snapshot).liveStage, 'Physical iPhone check passed');
  report.decisions = [{ id: 'merge', category: 'merge', commit: head, state: 'declined' }];
  assert.equal(releaseOverview(snapshot).candidates[0].approval, null);
});

test('A public checkpoint enables continuation only when it matches verified HEAD', () => {
  const assignment = { ...registered, head, publicCheckpoint: { commit: head, observedHead: head, source } };
  const snapshot = { checks: [], dependencies: [],
    directives: [{ number: 509, source, state: 'Creator source confirmed' }] };
  const prompt = continuationFor(assignment, null, snapshot);
  assert.match(prompt, new RegExp(head));
  assert.match(prompt, /#509/);
  assert.match(prompt, /before writing/);
  assert.equal(continuationFor({ ...assignment, head: old }, null, snapshot), null);
  assignment.publicCheckpoint.preserved = true;
  assert.equal(continuationFor(assignment, null, snapshot), null);
});
