import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterRoadmap } from '../src/roadmap.mjs';
import { studioTimeline } from '../src/insights.mjs';

const source = 'https://github.com/hdog960/Mythwrought/pull/502';
const dependencies = [
  { id: 'release-core', assignment: 'release', prerequisite: 'core', state: 'required', source },
  { id: 'core-interface', assignment: 'core', prerequisite: 'interface', state: 'required', source },
  { id: 'release-assets', assignment: 'release', prerequisite: 'assets', state: 'required', source },
  { id: 'done', assignment: 'release', prerequisite: 'unrelated', state: 'resolved', source },
];
const developers = ['release', 'core', 'interface', 'assets', 'unrelated'].map(assignmentId => ({
  assignmentId, project: assignmentId,
}));
const estimates = { release: 2, core: 4, interface: 3, assets: 1 };
const reports = Object.entries(estimates).map(([assignmentId, likely]) => ({
  assignmentId, reportId: `report-${assignmentId}`, reportedAt: '2026-11-28T02:00:00Z',
  estimate: { optimistic: likely, likely, conservative: likely + 1, confidence: 'low' },
}));
reports[0].roadmap = { revision: 'r1', milestones: [
  { id: 'first', label: 'First', kind: 'development', effort: 1, complete: true },
  { id: 'second', label: 'Second', kind: 'qualification', effort: 1, complete: false },
] };

test('Master Roadmap shows measured milestones and limits the critical path to complete dependency evidence', () => {
  const snapshot = { developers, reports, dependencies };
  const scope = [developers[0]];
  const overview = masterRoadmap(snapshot, scope);
  assert.deepEqual([overview.planCount, overview.completed, overview.milestoneCount], [1, 1, 2]);
  assert.deepEqual(overview.criticalPath.programs.map(item => item.developer.assignmentId), ['interface', 'core', 'release']);
  assert.equal(overview.criticalPath.sessions, 9);
  assert.equal(masterRoadmap({ ...snapshot, reports: reports.filter(item => item.assignmentId !== 'interface') }, scope).criticalPath, null);
  const cyclic = masterRoadmap({ ...snapshot, dependencies: [...dependencies,
    { id: 'loop', assignment: 'interface', prerequisite: 'release', state: 'required', source }] }, scope);
  assert.equal(cyclic.criticalPath, null);
  assert.equal(cyclic.cycles.length, 1);
  assert.deepEqual(masterRoadmap(snapshot, [developers.at(-1)]).edges, []);
});

test('Studio timeline ties merges and deployment history to the selected workspace', () => {
  const head = 'a'.repeat(40);
  const timestamp = '2026-11-28T02:00:00Z';
  const developer = { assignmentId: 'release', project: 'Release', pr: 502, repository: 'hdog960/Mythwrought' };
  const snapshot = {
    generatedAt: '2026-11-28T03:00:00Z', checks: [], reports: [
      { assignmentId: 'release', outcome: 'development', sessionId: 's1', completed: ['Fixed the release'],
        newlyCompleted: ['m1'], reportedAt: timestamp, source },
      { assignmentId: 'release', outcome: 'qualification', sessionId: 's1',
        newlyCompleted: ['m1'], reportedAt: timestamp, source },
    ],
    pulls: [{ number: 502, state: 'merged', title: 'Qualified release', mergeCommit: head, mergedAt: timestamp, source },
      { number: 515, state: 'merged', title: 'Other release', mergedAt: timestamp, source }],
    deployments: [{ id: 1, state: 'inactive', head, lastSuccessAt: timestamp, source },
      { id: 2, state: 'success', head, updatedAt: timestamp, source }],
  };
  const timeline = studioTimeline(snapshot, [developer], 1);
  assert.deepEqual(timeline.map(item => item.type), ['Reported accomplishment', 'Reported milestone', 'GitHub merge', 'Successful Pages deployment']);
  assert.ok(studioTimeline(snapshot, [developer], 1, true).some(item => item.title === 'Other release'));
});
