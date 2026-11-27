import { latestFor, WORKFLOW_STATES } from './model.mjs';

export const automaticSlots = 15;
export const accountLabels = { personal: 'Personal', business: 'Business', unclassified: 'Unclassified' };
export const workStates = ['running', 'queued', 'waiting', 'blocked', 'complete', 'finished', 'recorded', 'failed', 'paused', 'deferred', 'unknown'];
export const workLabels = {
  running: 'Running', queued: 'Queued', waiting: 'Waiting', blocked: 'Blocked', complete: 'Complete',
  finished: 'Last session finished', recorded: 'Scheduled run recorded', failed: 'Last session failed', paused: 'Schedule paused', deferred: 'Deferred', unknown: 'Unknown',
};
export const workflowLabels = { queued: 'Queued', in_progress: 'Running', waiting: 'Waiting' };

export function accountOf(developer, labels) {
  const label = labels?.[developer.id];
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

export function continuationFor(developer, report) {
  return report?.commit === developer.head && report?.continuation ? report.continuation : null;
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

export function developerWork(snapshot, developers = snapshot.developers, now = Date.now()) {
  const runs = workflowBuckets(snapshot).flatMap(bucket => bucket.runs);
  return developers.map(developer => {
    const report = latestFor(snapshot.reports, developer.assignmentId);
    const observed = report?.execution;
    const age = observed ? now - Date.parse(observed.observedAt) : Infinity;
    const current = observed && age >= 0 && age <= activeWindow;
    const deferred = developer.deferred || developer.status === 'Deferred per brief';
    const state = deferred ? 'deferred' : current ? observed.state
      : report?.releaseReadiness === 'fully accepted' ? 'complete'
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
