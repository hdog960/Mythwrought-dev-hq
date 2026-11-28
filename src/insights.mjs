import { creatorActions } from './command-center.mjs';
import { latestFor } from './model.mjs';

const signals = {
  technical: { label: 'Engineering blockers', weight: 20, next: 'Review and resolve the reported blocker.' },
  creator: { label: 'Creator decisions', weight: 15, next: 'Review the current request in the Command Center.' },
  qualification: { label: 'Required qualification', weight: 25, next: 'Inspect the exact-head required gate and its result.' },
  review: { label: 'Requested PR reviews', weight: 15, next: 'Follow up with the requested reviewers.' },
  dependencies: { label: 'Dependencies and handoffs', weight: 15, next: 'Check the prerequisite and the next action with its owner.' },
  checkpoint: { label: 'Checkpoints behind HEAD', weight: 10, next: 'Reconcile the checkpoint with the current branch before resuming.' },
};
const hour = 60 * 60_000;

function recordedCheckpoint(developer, latest) {
  const candidates = [];
  if (latest && developer.reportFeedState !== 'unavailable') {
    candidates.push({ ...latest, recordedAt: latest.reportedAt });
  }
  const publicRecord = developer.publicCheckpoint;
  if (publicRecord && !publicRecord.preserved && publicRecord.observedHead === developer.head) candidates.push(publicRecord);
  return candidates.find(item => item.commit === developer.head) ??
    candidates.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
}

export function congestion(snapshot, scope = snapshot.developers) {
  const actions = creatorActions(snapshot, scope);
  const assignments = scope.map(developer => {
    const latest = latestFor(snapshot.reports, developer.assignmentId);
    const report = developer.head && latest?.commit === developer.head && developer.reportFeedState !== 'unavailable' ? latest : null;
    const pull = developer.repository.toLowerCase() === 'hdog960/mythwrought' && developer.head &&
      snapshot.pulls.find(item => item.number === developer.pr && item.head === developer.head && item.headRepositoryMatches);
    return { developer, latest, report, pull };
  });
  const candidates = assignments.filter(item => item.pull?.state === 'open');
  const constraints = snapshot.dependencies.filter(edge => edge.state === 'required' &&
    scope.some(developer => developer.assignmentId === edge.assignment));
  const eligible = assignments.filter(({ developer, report }) => !developer.deferred && developer.status !== 'Deferred per brief' &&
    developer.ownership?.assignmentState !== 'unassigned' && report?.releaseReadiness !== 'fully accepted');
  const components = Object.entries(signals).map(([id, signal]) => ({ id, ...signal, known: 0, entries: [] }));
  for (const { developer, latest, report, pull } of eligible) {
    const currentActions = actions.filter(item => item.developers.includes(developer));
    const blockers = currentActions.find(item => item.kind === 'engineering');
    const approval = currentActions.find(item => item.decision);
    const gate = pull?.state === 'open' && developer.requiredGate?.head === pull.head ? developer.requiredGate : null;
    const review = pull?.state === 'open' && !pull.draft && developer.review?.head === pull.head ? developer.review : null;
    const dependency = constraints.find(item => item.assignment === developer.assignmentId);
    const reportedDependency = report?.blockers?.find(item => item.category === 'dependency');
    const checkpoint = developer.head && recordedCheckpoint(developer, latest);
    const completeFeed = developer.reportFeedState === 'ok';
    const outcomes = {
      technical: blockers ? { detail: blockers.detail, source: blockers.sources[0] } :
        completeFeed && Array.isArray(report?.blockers) ? false : undefined,
      creator: approval ? { detail: approval.title, source: approval.sources[0] } :
        completeFeed && Array.isArray(report?.decisions) ? false : undefined,
      qualification: ['failed', 'pending'].includes(gate?.state) ? { detail: `Required gate ${gate.state}`, source: gate.source } :
        gate?.state === 'clear' || (pull && pull.state !== 'open') ? false : undefined,
      review: review?.requested > 0 ? { detail: `PR #${pull.number} · ${review.requested} open review requests`, source: review.source } :
        review?.requested === 0 || (pull && (pull.draft || pull.state !== 'open')) ? false : undefined,
      dependencies: dependency ? { detail: dependency.scope, source: dependency.source } :
        reportedDependency ? { detail: reportedDependency.description, source: reportedDependency.evidence } :
          completeFeed && report?.dependencyIds?.length === 0 ? false : undefined,
      checkpoint: checkpoint ? checkpoint.commit === developer.head ? false : {
        detail: `${checkpoint.commit.slice(0, 8)} → ${developer.head.slice(0, 8)}`, source: checkpoint.source,
      } : undefined,
    };
    for (const component of components) {
      const result = outcomes[component.id];
      if (result === undefined) continue;
      component.known++;
      if (result) component.entries.push({ developer, ...result });
    }
  }
  const denominator = eligible.length;
  const observed = denominator ? components.reduce((total, item) => total + item.weight * item.known / denominator, 0) : 0;
  const pressure = denominator ? components.reduce((total, item) => total + item.weight * item.entries.length / denominator, 0) : 0;
  const full = denominator > 0 && components.every(item => item.known === denominator);
  return { components, denominator, candidates, constraints, coverage: Math.round(observed),
    score: full ? Math.round(pressure) : null,
    lower: observed > 0 ? Math.floor(pressure) : null,
    upper: observed > 0 ? Math.min(100, Math.ceil(pressure + 100 - observed)) : null };
}

export function summarize(snapshot, days, anchor = Date.parse(snapshot.generatedAt)) {
  const start = days === null ? -Infinity : anchor - days * 24 * hour;
  const reports = snapshot.reports.filter(item => Date.parse(item.reportedAt) >= start && Date.parse(item.reportedAt) <= anchor);
  const meaningful = reports.filter(item => item.outcome === 'development');
  const assignments = new Set(reports.map(item => item.assignmentId));
  const milestones = new Set(reports.flatMap(item => (item.newlyCompleted ?? []).map(id => `${item.assignmentId}/${id}`)));
  return {
    reports, meaningful, assignments: assignments.size, milestones: milestones.size,
    accomplishments: meaningful.slice(-5).reverse().flatMap(item => item.completed?.slice(0, 1).map(text => ({ text, item })) ?? []),
  };
}
