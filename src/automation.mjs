import { nextScheduledRun } from './operations.mjs';

const newest = (a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt) || b.reportId.localeCompare(a.reportId);
const unsuccessful = ['failed', 'blocked'];

function recentSessions(snapshot, developer) {
  const reports = snapshot.reports.filter(item => item.assignmentId === developer.assignmentId && item.sessionId).sort(newest);
  const sessions = new Map();
  for (const report of reports) {
    if (!sessions.has(report.sessionId)) sessions.set(report.sessionId, report);
  }
  return [...sessions.values()];
}

function leading(sessions, predicate) {
  const firstDifferent = sessions.findIndex(item => !predicate(item));
  return firstDifferent === -1 ? sessions : sessions.slice(0, firstDifferent);
}

export function efficiencySignals(snapshot, developers = snapshot.developers) {
  const results = [];
  const qualification = new Map();
  for (const developer of developers) {
    const sessions = recentSessions(snapshot, developer);
    const administrative = leading(sessions, item => item.outcome === 'administration');
    if (administrative.length > 1) results.push({ developer, label: 'Consecutive administrative reports',
      detail: `${administrative.length} reported sessions`, sources: administrative.map(item => item.source) });
    for (const blocker of sessions[0]?.blockers ?? []) {
      if (blocker.category === 'deferral') continue;
      const repeated = leading(sessions, item => item.blockers?.some(candidate =>
        candidate.id === blocker.id && candidate.category === blocker.category));
      if (repeated.length > 1) results.push({ developer, label: 'Same reported blocker',
        detail: blocker.description, sources: [...new Set([blocker.evidence, ...repeated.map(item => item.source)])] });
    }
    for (const session of sessions.slice(0, 8)) {
      for (const evidence of session.qualification ?? []) {
        if (!evidence.workflowId || !evidence.artifactHash || !evidence.environment || evidence.outcome !== 'success') continue;
        const key = JSON.stringify([developer.assignmentId, evidence.commit, evidence.suite, evidence.environment, evidence.scope, evidence.artifactHash]);
        if (!qualification.has(key)) qualification.set(key, { developer, detail: evidence.suite, runs: new Map() });
        qualification.get(key).runs.set(evidence.workflowId, evidence.source);
      }
    }
  }
  for (const { developer, detail, runs } of qualification.values()) {
    if (runs.size > 1) results.push({ developer, label: 'Repeated qualification evidence',
      detail: `${detail} · ${runs.size} distinct runs with matching reported artifacts`, sources: [...new Set(runs.values())] });
  }
  return results;
}

export function automationOverview(snapshot, developers = snapshot.developers, now = Date.now()) {
  return developers.filter(item => item.category === 'automatic').map(developer => {
    const sessions = recentSessions(snapshot, developer);
    const latest = sessions[0];
    const accomplishments = sessions.find(item => item.outcome === 'development' && item.completed?.length);
    const age = now - Date.parse(developer.scheduleObservedAt);
    const scheduleCurrent = age >= 0 && age < 24 * 60 * 60_000;
    const release = developer.pr && developer.repository.toLowerCase() === 'hdog960/mythwrought' && snapshot.publication &&
      snapshot.pulls.find(item => item.state === 'merged' && item.number === developer.pr &&
        item.headRepositoryMatches && item.branch === developer.branch && item.mergeCommit === snapshot.publication.head);
    const currentReport = latest && latest.commit === developer.head && developer.reportFeedState !== 'unavailable' ? latest : null;
    const failures = latest && (unsuccessful.includes(latest.outcome) || ['development', 'qualification'].includes(latest.outcome)) ?
      leading(sessions, item => unsuccessful.includes(item.outcome)).length : null;
    return {
      developer, latest, accomplishments, failures, currentReport, scheduleCurrent,
      next: scheduleCurrent ? nextScheduledRun(developer, now) : null,
      production: release ? snapshot.publication : null,
    };
  });
}
