export const SNAPSHOT_VERSION = 1;
export const SHA = /^[a-f0-9]{40}$/;
export const REPO = /^[-\w]+\/[-.\w]+$/;
export const ID = /^[-a-z0-9]{1,100}$/;
export const OUTCOMES = ['development', 'qualification', 'administration', 'waiting', 'blocked', 'failed'];
export const CATEGORIES = ['manual', 'automatic', 'codex'];
export const EXECUTION_STATES = ['queued', 'running', 'waiting', 'blocked', 'complete'];
export const WORKFLOW_STATES = ['queued', 'in_progress', 'waiting'];
export const WORKSPACES = ['personal', 'business'];
export const BLOCKER_TYPES = ['creator approval', 'dependency', 'required CI failure', 'CI waiting', 'merge conflict',
  'access', 'missing source', 'technical defect', 'physical iPhone', 'architecture', 'reporting', 'deferral'];
export const APPROVAL_TYPES = ['merge', 'deployment', 'physical iPhone', 'roadmap', 'reassignment',
  'scope', 'dependency exception', 'architecture', 'administrative integration'];
export const READINESS = ['planning', 'development', 'integration', 'qualification', 'awaiting approval',
  'approved for exact commit', 'merged', 'deployment pending', 'deployed', 'public verification pending',
  'physical acceptance pending', 'fully accepted'];

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isISO = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
export const isSha = value => typeof value === 'string' && SHA.test(value);
export const isId = value => typeof value === 'string' && ID.test(value);

export function isOwnership(value) {
  return isRecord(value) && WORKSPACES.includes(value.workspace) &&
    Array.isArray(value.exclusiveScopes) && value.exclusiveScopes.length <= 30 && value.exclusiveScopes.every(isId) &&
    new Set(value.exclusiveScopes).size === value.exclusiveScopes.length &&
    (value.assignmentState === 'assigned' ? typeof value.owner === 'string' && Boolean(value.owner.trim()) :
      value.assignmentState === 'unassigned' && value.owner === null && value.exclusiveScopes.length === 0);
}

export function sourceLink(value) {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search) return null;
    if (url.hostname === 'github.com' && /^\/hdog960\/(Mythwrought(?:-dev-hq)?)(?:\/[^\\\s]*)?$/i.test(url.pathname)) return url.href;
    if (url.hostname === 'hdog960.github.io' && /^\/Mythwrought(?:-dev-hq)?\/$/.test(url.pathname)) return url.href;
  } catch { /* Unparseable URL. */ }
  return null;
}

export function isSnapshot(data) {
  if (!isRecord(data) || data.schemaVersion !== SNAPSHOT_VERSION || !isISO(data.generatedAt)
      || !isRecord(data.health) || !isRecord(data.health.sources) || !isRecord(data.production)) return false;
  if (!Object.values(data.health.sources).every(source => isRecord(source) &&
    ['ok', 'partial', 'error'].includes(source.state) && (source.lastSuccess == null || isISO(source.lastSuccess)))) return false;
  const arrays = ['developers', 'pulls', 'issues', 'workflows', 'checks', 'releases', 'deployments', 'reports', 'directives', 'dependencies'];
  if (!arrays.every(key => Array.isArray(data[key]) && data[key].every(isRecord))) return false;
  const nullable = (value, condition) => value == null || condition(value);
  const text = value => typeof value === 'string';
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const records = value => Array.isArray(value) && value.every(isRecord);
  return nullable(data.mainHead, isSha) && nullable(data.health.lastAttempt, isISO) &&
    nullable(data.health.lastSuccess, isISO) && nullable(data.health.nextExpected, isISO) &&
    nullable(data.schedule, value => isRecord(value) && Object.hasOwn(value, 'latest') && nullable(value.latest, item => isRecord(item) &&
      isISO(item.createdAt) && sourceLink(item.source) && nullable(item.status, text) && nullable(item.conclusion, text))) &&
    data.developers.every(item => isId(item.id) && isId(item.assignmentId) && nullable(item.head, isSha) &&
      nullable(item.branchObservedAt, isISO) && nullable(item.ownership, value => isOwnership(value) &&
        sourceLink(value.source) && isISO(value.reportedAt)) &&
      nullable(item.reportFeedState, value => ['ok', 'partial', 'unavailable'].includes(value)) &&
      nullable(item.scheduleEnabled, value => typeof value === 'boolean') &&
      nullable(item.scheduleObservedAt, isISO) && nullable(item.scheduleStartsAt, isISO) &&
      nullable(item.lastSchedulerResult, value => isRecord(value) && isISO(value.completedAt) && isISO(value.observedAt) &&
        typeof value.needsCreatorAction === 'boolean' && nullable(value.publicOutput, sourceLink)) &&
      Array.isArray(item.registeredSources) && item.registeredSources.every(text) &&
      CATEGORIES.includes(item.category) && text(item.name) && text(item.project) && text(item.authority) && text(item.status)) &&
    data.reports.every(item => isId(item.reportId) && isId(item.assignmentId) &&
      isISO(item.reportedAt) && isSha(item.commit) && OUTCOMES.includes(item.outcome) &&
      nullable(item.ownership, isOwnership) &&
      nullable(item.completed, value => Array.isArray(value) && value.every(text)) &&
      nullable(item.remaining, value => Array.isArray(value) && value.every(text)) &&
      nullable(item.roadmap, value => isRecord(value) && isId(value.revision) && records(value.milestones) &&
        value.milestones.every(milestone => isId(milestone.id) && text(milestone.label) &&
          typeof milestone.effort === 'number' && Number.isFinite(milestone.effort) && milestone.effort > 0 &&
          ['development', 'qualification'].includes(milestone.kind) && typeof milestone.complete === 'boolean')) &&
      nullable(item.execution, value => isRecord(value) && EXECUTION_STATES.includes(value.state) &&
        isISO(value.observedAt) && sourceLink(value.evidence)) &&
      nullable(item.newlyCompleted, value => Array.isArray(value) && value.every(isId)) &&
      ['blockers', 'decisions', 'quantitative', 'qualification', 'reusableEvidence'].every(key => nullable(item[key], records))) &&
    data.pulls.every(item => positive(item.number) && isSha(item.head) && text(item.title)) &&
    data.issues.every(item => positive(item.number) && text(item.title)) &&
    data.workflows.every(item => positive(item.id) && isSha(item.head) && text(item.title)) &&
    nullable(data.workflowLoad, value => isRecord(value) && WORKFLOW_STATES.every(status => {
      const bucket = value[status];
      return bucket === null || (isRecord(bucket) && Number.isSafeInteger(bucket.total) && bucket.total >= 0 &&
        isISO(bucket.observedAt) && records(bucket.runs) && bucket.runs.length <= bucket.total &&
        bucket.runs.every(item => positive(item.id) && isSha(item.head) && text(item.title) && item.status === status));
    })) &&
    data.checks.every(item => positive(item.id) && isSha(item.head) && text(item.title)) &&
    data.deployments.every(item => positive(item.id) && isSha(item.head)) &&
    data.releases.every(item => positive(item.id) && text(item.name)) &&
    data.directives.every(item => positive(item.number) && text(item.name) && text(item.summary)) &&
    data.dependencies.every(item => isId(item.id) && isId(item.assignment) && isId(item.prerequisite) && text(item.state)) &&
    nullable(data.production.version, text) && nullable(data.production.observedAt, isISO);
}

export function freshState(snapshot, age = Date.now()) {
  if (!snapshot) return 'Unavailable';
  const core = snapshot.health.sources;
  if (!isISO(snapshot.health.lastAttempt) || age - Date.parse(snapshot.health.lastAttempt) > 45 * 60_000 ||
      !isISO(snapshot.health.lastSuccess) || age - Date.parse(snapshot.health.lastSuccess) > 45 * 60_000) return 'Stale snapshot';
  if (Object.values(core).some(item => item.state !== 'ok')) return 'Partial coverage';
  return 'Published snapshot';
}

export function latestFor(reports, assignmentId) {
  return reports.filter(report => report.assignmentId === assignmentId)
    .sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt) || b.reportId.localeCompare(a.reportId))[0] ?? null;
}

export function approvalQueue(snapshot) {
  const result = [];
  for (const developer of snapshot.developers) {
    const history = snapshot.reports.filter(report => report.assignmentId === developer.assignmentId)
      .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt) || a.reportId.localeCompare(b.reportId));
    const requests = new Map();
    for (const report of history) {
      for (const decision of report.decisions ?? []) requests.set(decision.id, { decision, report });
    }
    for (const { decision, report } of requests.values()) {
      const headBound = ['merge', 'deployment', 'physical iPhone'].includes(decision.category);
      const currentHead = developer.head;
      const state = headBound && (!decision.commit || !currentHead) ? 'HEAD unverified'
        : headBound && decision.commit !== currentHead ? 'HEAD changed' : decision.state;
      if (state !== 'authorized' && state !== 'declined') result.push({ ...decision, state, developer, report });
    }
  }
  result.sort((a, b) => (a.developer.priority ?? Infinity) - (b.developer.priority ?? Infinity) ||
    Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  return result;
}

export function estimateFor(report) {
  if (!report) return null;
  if (report.estimate?.likely === 0 && report.releaseReadiness !== 'fully accepted') return null;
  return report.estimate ?? null;
}

export function cyclesIn(dependencies) {
  const links = new Map();
  for (const edge of dependencies.filter(edge => edge.state !== 'resolved')) {
    links.set(edge.assignment, [...(links.get(edge.assignment) ?? []), edge.prerequisite]);
  }
  const found = new Set();
  const complete = new Set();
  function visit(node, path) {
    const position = path.indexOf(node);
    if (position !== -1) {
      found.add(path.slice(position).sort().join(' · '));
      return;
    }
    if (complete.has(node)) return;
    for (const target of links.get(node) ?? []) visit(target, [...path, node]);
    complete.add(node);
  }
  for (const node of links.keys()) visit(node, []);
  return [...found];
}
