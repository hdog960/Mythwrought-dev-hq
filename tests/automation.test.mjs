import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automationOverview, efficiencySignals } from '../src/automation.mjs';
import { registry } from '../config/sources.mjs';
import { inspectChangeScope } from '../scripts/scope.mjs';

const developer = registry.find(item => item.id === 'water-engine');
const commit = 'a'.repeat(40);
const report = (number, outcome, more = {}) => ({
  assignmentId: developer.assignmentId, reportId: `report-${number}`, sessionId: `session-${number}`,
  reportedAt: `2026-11-28T01:0${number}:00Z`, commit, outcome, source: developer.source, ...more,
});

test('Automation counts sourced failed or blocked sessions and ages scheduler observations', () => {
  const now = Date.parse('2026-11-28T01:10:00Z');
  const assigned = { ...developer, head: commit };
  const snapshot = {
    developers: [assigned], pulls: [], reports: [report(1, 'development', { completed: ['Changed source'] }),
      report(2, 'blocked'), report(3, 'failed'), report(4, 'failed', { sessionId: 'session-3' })],
  };
  const [tracked] = automationOverview(snapshot, undefined, now);
  assert.equal(tracked.failures, 2);
  assert.equal(tracked.accomplishments.completed[0], 'Changed source');
  assert.ok(tracked.next);
  assert.equal(automationOverview(snapshot, undefined, now + 24 * 60 * 60_000)[0].next, null);
  assert.equal(automationOverview({ ...snapshot, reports: [] }, undefined, now)[0].failures, null);
});

test('Efficiency distinguishes repeated qualification runs from re-delivered or reused evidence', () => {
  const evidence = { suite: 'Targeted gate', artifactHash: 'sha256:' + '1'.repeat(64), workflowId: 1, outcome: 'success',
    environment: 'Chromium', scope: 'Lane', commit, source: developer.source };
  const blocker = { id: 'review', category: 'access', description: 'Shared fixture unavailable', evidence: developer.source };
  const snapshot = { developers: [developer], reports: [
    report(1, 'administration', { blockers: [blocker], qualification: [evidence] }),
    report(2, 'administration', { blockers: [blocker], reusableEvidence: [{ ...evidence, workflowId: 2 }] }),
  ] };
  assert.deepEqual(efficiencySignals(snapshot).map(item => item.label), ['Consecutive administrative reports', 'Same reported blocker']);
  snapshot.reports[1].qualification = [{ ...evidence, workflowId: 3 }];
  assert.ok(efficiencySignals(snapshot).some(item => item.label === 'Repeated qualification evidence'));
});

test('Scope comparisons use pinned refs and include the old path of a rename', async () => {
  const base = 'b'.repeat(40);
  const pull = { base, head: commit };
  const result = { base_commit: { sha: base }, merge_base_commit: { sha: base }, files: [
    { status: 'renamed', filename: 'src/owned/code.mjs', previous_filename: 'src/shared/code.mjs' },
    { status: 'modified', filename: '.github/workflows/example.yml' },
  ] };
  const scope = await inspectChangeScope(pull, /^src\/owned\//, async route => {
    assert.match(route, new RegExp(`${base}\\.\\.\\.${commit}`));
    return result;
  });
  assert.deepEqual(scope.outside, ['src/shared/code.mjs', '.github/workflows/example.yml']);
  assert.equal(scope.infrastructure, 1);
  assert.equal(scope.complete, true);
  const partial = await inspectChangeScope(pull, /^src\/owned\//, async () =>
    ({ ...result, files: Array(300).fill(result.files[0]) }));
  assert.equal(partial.complete, false);
  await assert.rejects(inspectChangeScope(pull, /^src\/owned\//, async () => ({ ...result, base_commit: { sha: commit } })));
});
