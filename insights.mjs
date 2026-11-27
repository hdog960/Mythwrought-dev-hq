import { approvalQueue, latestFor } from './model.mjs';

const riskWeights = {
  technical: 25,
  creator: 20,
  qualification: 20,
  dependencies: 20,
  inactivity: 10,
  contention: 5,
};
const technical = ['technical defect', 'access', 'merge conflict', 'missing source'];
const hour = 60 * 60_000;

export function congestion(snapshot) {
  const eligible = snapshot.developers.map(developer => ({
    developer, latest: latestFor(snapshot.reports, developer.assignmentId),
  })).filter(({ developer, latest }) => !developer.deferred && developer.status !== 'Deferred per brief' &&
    latest?.releaseReadiness !== 'fully accepted');
  const approval = approvalQueue(snapshot);
  const components = Object.entries(riskWeights).map(([id, weight]) => ({ id, weight, known: 0, affected: 0 }));
  for (const { developer, latest } of eligible) {
    const blockers = latest?.blockers;
    const checks = snapshot.checks.filter(item => item.number === developer.pr && item.head === developer.head);
    const requirementsKnown = checks.length > 0 && checks.every(item => item.mandatory !== null);
    const qualificationFailure = checks.some(item => item.mandatory && ['failure', 'timed_out', 'action_required'].includes(item.conclusion));
    const approvalRequired = approval.some(item => item.developer.id === developer.id);
    const required = snapshot.dependencies.filter(item => item.assignment === developer.assignmentId &&
      latest?.dependencyIds?.includes(item.id));
    const history = snapshot.reports.filter(item => item.assignmentId === developer.assignmentId).slice(-3);
    const outcomes = {
      technical: blockers?.some(item => technical.includes(item.category)),
      creator: approvalRequired || (latest?.decisions ? false : undefined),
      qualification: qualificationFailure || (requirementsKnown ? false : undefined),
      dependencies: latest?.dependencyIds && required.length === latest.dependencyIds.length ?
        required.some(item => item.state !== 'resolved') : undefined,
      inactivity: history.length >= 3 ? history.every(item => ['failed', 'waiting'].includes(item.outcome)) : undefined,
      contention: blockers?.some(item => item.category === 'CI waiting'),
    };
    // Attribute a project's overlapping positive signals to its highest-weight observed cause.
    let counted = false;
    for (const component of components) {
      const result = outcomes[component.id];
      if (result === undefined) continue;
      component.known++;
      if (result && !counted) {
        component.affected++;
        counted = true;
      }
    }
  }
  const denominator = eligible.length;
  const observed = denominator ? components.reduce((total, item) => total + item.weight * item.known / denominator, 0) : 0;
  const pressure = denominator ? components.reduce((total, item) => total + item.weight * item.affected / denominator, 0) : 0;
  return { components, denominator, coverage: Math.round(observed),
    score: observed === 100 ? Math.round(pressure) : null, knownPressure: observed > 0 ? Math.round(pressure) : null };
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
