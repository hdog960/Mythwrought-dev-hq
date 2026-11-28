import { freshState, handoffFrom, latestFor, WORKFLOW_STATES } from './model.mjs';
import { creatorActions } from './command-center.mjs';

export const automaticSlots = 15;
export const accountLabels = { personal: 'Personal', business: 'Business', unclassified: 'Unclassified' };
export const workStates = ['running', 'queued', 'waiting', 'blocked', 'complete', 'finished', 'recorded', 'failed', 'paused', 'deferred', 'unknown'];
export const workLabels = {
  running: 'Running', queued: 'Queued', waiting: 'Waiting', blocked: 'Blocked', complete: 'Complete',
  finished: 'Last session finished', recorded: 'Scheduled run recorded', failed: 'Last session failed', paused: 'Schedule paused', deferred: 'Deferred', unknown: 'Unknown',
};
export const workflowLabels = { queued: 'Queued', in_progress: 'Running', waiting: 'Waiting' };

export function accountOf(developer, labels) {
  const label = developer.ownership?.workspace ?? labels?.[developer.id];
  return label && Object.hasOwn(accountLabels, label) ? label : 'unclassified';
}

export function scopedDevelopers(developers, scope, labels) {
  return scope === 'all' ? developers : developers.filter(item => accountOf(item, labels) === scope);
}

export function conversationURL(value) {
  if (typeof value !== 'string' || value.length > 240) return null;
  try {
    const url = new URL(value);
    const chat = /^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]+\/?$/;
    return url.protocol === 'https:' && ['chatgpt.com', 'chat.openai.com'].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && chat.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export function continuationFor(developer, report, snapshot) {
  if ((developer.ownershipRequired && !developer.ownership) || (snapshot && handoffFrom(snapshot, developer.assignmentId))) return null;
  const exactReport = developer.head && report?.commit === developer.head && developer.reportFeedState !== 'unavailable' ? report : null;
  if (!snapshot) return exactReport?.continuation ?? null;
  const reference = developer.publicCheckpoint;
  const exactReference = developer.head && reference?.commit === developer.head && reference.observedHead === developer.head &&
    !reference.preserved ? reference : null;
  if (!developer.branch || (!exactReference && !exactReport?.continuation && !exactReport?.nextObjective && !exactReport?.checkpoint)) return null;
  const checkpoint = exactReport?.checkpoint ?? exactReference?.source ?? exactReport.source;
  const owners = developer.ownership;
  const checks = snapshot.checks.filter(item => developer.pr && item.number === developer.pr && item.head === developer.head &&
    item.mandatory === true && !item.preserved).slice(0, 10).map(item =>
    `${item.title} (${item.conclusion ?? item.status}) ${item.source}`);
  const reported = [...(exactReport?.qualification ?? []), ...(exactReport?.reusableEvidence ?? [])]
    .filter(item => item.commit === developer.head).slice(0, 8).map(item => `${item.suite} (${item.outcome}) ${item.source}`);
  const blockers = (exactReport?.blockers ?? []).slice(0, 8).map(item => `${item.category}: ${item.description} ${item.evidence}`);
  const dependencies = snapshot.dependencies.filter(item => item.assignment === developer.assignmentId && item.state === 'required')
    .map(item => `${item.scope}, prerequisite ${item.prerequisite} ${item.source}`);
  const directives = snapshot.directives.filter(item => item.state === 'Creator source confirmed' &&
    (item.number !== 507 || developer.id === 'builder')).map(item => `#${item.number} ${item.source}`);
  return [
    `Resume ${developer.name} on ${developer.project} (${developer.assignmentId}).`,
    `Repository ${developer.repository}. Branch ${developer.branch}. Last observed exact HEAD ${developer.head}.`,
    `Read the current main-branch procedures and compare GitHub's current branch and PR with this SHA before writing.`,
    `Read the checkpoint at ${checkpoint} and verify any newer authorized checkpoint.`,
    developer.source ? `Assignment source ${developer.source}` : null,
    owners ? `Creator ownership: ${accountLabels[owners.workspace]} · ${owners.owner ?? 'Unassigned'}. Source ${owners.source}` :
      'Confirm workspace and ownership using the canonical assignment.',
    owners?.exclusiveScopes?.length ? `Recorded exclusive scopes: ${owners.exclusiveScopes.join(', ')}.` : null,
    directives.length ? `Applicable creator directives:\n${directives.join('\n')}` : 'Find the applicable current creator directives before writing.',
    checks.length ? `Observed required GitHub checks at this exact commit:\n${checks.join('\n')}` : null,
    reported.length ? `Qualification evidence linked by the report:\n${reported.join('\n')}` : null,
    blockers.length || dependencies.length ? `Recorded blockers and dependencies:\n${[...blockers, ...dependencies].join('\n')}` :
      'Confirm current blockers in the canonical checkpoint.',
    exactReport?.nextObjective ? `Reported next objective: ${exactReport.nextObjective}` : null,
    exactReport?.continuation ? `Owner handoff:\n${exactReport.continuation}` : 'Follow the next authorized action documented in the checkpoint.',
    'Keep changes within the existing ownership. Verify evidence and obtain explicit creator approval for ownership changes, merges, or deployment.',
  ].filter(Boolean).join('\n\n');
}

export function workflowBuckets(snapshot) {
  return WORKFLOW_STATES.map(status => ({
    status, label: workflowLabels[status], total: snapshot.workflowLoad?.[status]?.total ?? null,
    observedAt: snapshot.workflowLoad?.[status]?.observedAt ?? null,
    runs: snapshot.workflowLoad?.[status]?.runs ?? [],
    preserved: snapshot.health.sources['workflowLoad:' + status]?.state === 'error',
  }));
}

const activeWindow = 2 * 60 * 60_000;

export function assignmentStatus(snapshot, developer, now = Date.now()) {
  const status = (label, tone, basis, source) => ({ label, tone, basis, source });
  const handoff = handoffFrom(snapshot, developer.assignmentId);
  if (handoff) return status('Handed off', 'gold', 'Creator-approved regional handoff', handoff.source);
  if (developer.ownershipRequired && !developer.ownership) return status('Status unknown', '', 'Creator ownership source unavailable');
  const latest = latestFor(snapshot.reports, developer.assignmentId);
  const scheduleAge = now - Date.parse(developer.scheduleObservedAt);
  const knownSchedule = scheduleAge >= 0 && scheduleAge < 24 * 60 * 60_000;
  if (developer.deferred || developer.status === 'Deferred per brief') {
    return status('Paused', 'gold', developer.status, developer.source);
  }
  if (freshState(snapshot, now) !== 'Stale snapshot') {
    const actions = creatorActions(snapshot, [developer]);
    const blocking = actions.find(item => ['ownership', 'qualification', 'engineering'].includes(item.kind));
    if (blocking) return status('Blocked', 'red', blocking.provenance, blocking.sources[0]);
    const request = actions.find(item => item.decision);
    if (request) return status('Awaiting creator approval', 'gold', request.provenance, request.sources[0]);
    const exactReport = developer.head && latest?.commit === developer.head && developer.reportFeedState !== 'unavailable';
    if (exactReport) {
      const dependency = snapshot.dependencies.find(edge => edge.assignment === developer.assignmentId &&
        edge.state === 'required' && latest.dependencyIds?.includes(edge.id));
      if (dependency) return status('Awaiting another developer', 'gold', dependency.scope, dependency.source);
      const executionAge = now - Date.parse(latest.execution?.observedAt);
      if (latest.execution?.state === 'running' && executionAge >= 0 && executionAge <= activeWindow) {
        return status('Developing', 'green', 'Recent developer execution report', latest.execution.evidence);
      }
      if (latest.releaseReadiness === 'fully accepted') return status('Completed', 'green', 'Accepted status reported', latest.source);
    }
    const active = workflowBuckets(snapshot).find(item => item.status === 'in_progress' && !item.preserved)?.runs ?? [];
    const test = developer.head && developer.repository.toLowerCase() === 'hdog960/mythwrought' && active.find(item =>
      item.qualification === true && item.head === developer.head && item.branch === developer.branch);
    if (test) return status('Testing', 'blue', 'GitHub workflow running on the exact commit', test.source);
    if (knownSchedule && developer.scheduleEnabled === false) return status('Paused', 'gold', 'Scheduler configuration when checked');
    if (knownSchedule && developer.scheduleEnabled === true) return status('Scheduled', 'purple', 'Scheduler configuration when checked');
    if (exactReport && latest.nextObjective && latest.blockers?.length === 0 &&
        !['running', 'queued', 'waiting', 'blocked'].includes(latest.execution?.state) &&
        ['development', 'qualification'].includes(latest.outcome)) {
      return status('Ready to continue', 'green', 'Exact-commit checkpoint with a reported next objective', latest.source);
    }
  }
  if (knownSchedule && developer.scheduleEnabled === false) return status('Paused', 'gold', 'Scheduler configuration when checked');
  return status('Status unknown', '', 'Current execution or checkpoint evidence unavailable');
}

export function developerWork(snapshot, developers = snapshot.developers, now = Date.now()) {
  const runs = workflowBuckets(snapshot).filter(bucket => !bucket.preserved).flatMap(bucket => bucket.runs);
  return developers.map(developer => {
    const report = latestFor(snapshot.reports, developer.assignmentId);
    const observed = report?.execution;
    const age = observed ? now - Date.parse(observed.observedAt) : Infinity;
    const current = observed && developer.head === report.commit && developer.reportFeedState !== 'unavailable' &&
      age >= 0 && age <= activeWindow;
    const deferred = developer.deferred || developer.status === 'Deferred per brief';
    const state = deferred ? 'deferred' : current ? observed.state
      : report?.releaseReadiness === 'fully accepted' && developer.head === report.commit ? 'complete'
      : developer.scheduleEnabled === false ? 'paused'
      : !report && developer.lastSchedulerResult ? 'recorded'
      : !report || observed ? 'unknown'
      : ['waiting', 'blocked', 'failed'].includes(report.outcome) ? report.outcome : 'finished';
    const relatedWorkflow = developer.head && developer.branch && developer.repository?.toLowerCase() === 'hdog960/mythwrought'
      ? runs.find(run => run.head === developer.head && run.branch === developer.branch)
      : null;
    return { developer, report, state, relatedWorkflow, source: observed?.evidence ?? report?.source ?? null,
      observedAt: observed?.observedAt ?? report?.reportedAt ?? developer.lastSchedulerResult?.observedAt ?? developer.scheduleObservedAt ?? null, stale: Boolean(observed && !current) };
  });
}

export function blockerSummary(snapshot, developers = snapshot.developers) {
  const entries = [];
  const dependencies = [];
  let reporting = 0;
  for (const developer of developers) {
    const report = latestFor(snapshot.reports, developer.assignmentId);
    if (Array.isArray(report?.blockers)) reporting++;
    for (const item of report?.blockers ?? []) {
      if (!['CI waiting', 'deferral'].includes(item.category)) entries.push({ developer, item });
    }
    const required = snapshot.dependencies.filter(edge => edge.assignment === developer.assignmentId && edge.state === 'required');
    if (required.length) dependencies.push({ developer, edges: required });
  }
  return { entries, dependencies, reporting };
}

export function nextScheduledRun(developer, now = Date.now()) {
  if (developer.scheduleEnabled !== true || !Number.isInteger(developer.minute) || !developer.timezone) return null;
  const start = Date.parse(developer.scheduleStartsAt);
  const after = Math.floor(now / 60_000) * 60_000 + 60_000;
  let candidate = Math.max(after, Number.isFinite(start) ? start : after);
  try {
    const minute = new Intl.DateTimeFormat('en-US', { timeZone: developer.timezone, minute: '2-digit' });
    for (let offset = 0; offset < 120; offset++, candidate += 60_000) {
      if (Number(minute.format(candidate)) === developer.minute) return new Date(candidate).toISOString();
    }
  } catch { /* Invalid configured timezone. */ }
  return null;
}
