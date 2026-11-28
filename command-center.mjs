import { approvalQueue, failedRequiredCheck, latestFor, sourceLink } from './model.mjs';

export const actionGroups = {
  ownership: { name: 'Ownership conflicts', tone: 'red', rank: 0 },
  qualification: { name: 'Failed mandatory qualifications', tone: 'red', rank: 1 },
  deployment: { name: 'Deployment approvals', tone: 'gold', rank: 2 },
  merge: { name: 'Merge approvals', tone: 'gold', rank: 3 },
  decision: { name: 'Developer decisions', tone: 'gold', rank: 4 },
  engineering: { name: 'Engineering blockers', tone: 'orange', rank: 5 },
  integration: { name: 'Ready for integration', tone: 'purple', rank: 6 },
  unassigned: { name: 'Unassigned developers', tone: 'blue', rank: 7 },
};

const engineeringTypes = new Set(['access', 'architecture', 'merge conflict', 'missing source', 'required CI failure', 'technical defect']);
const repoKey = item => item.repository.toLowerCase();

function overlaps(developers) {
  const groups = new Map();
  for (const developer of developers.filter(item => item.ownership?.assignmentState === 'assigned')) {
    const claims = developer.ownership.exclusiveScopes.map(scope => ['Scope ' + scope, 'scope/' + scope]);
    if (developer.branch) claims.push(['Branch ' + developer.branch, 'branch/' + developer.branch]);
    for (const [label, id] of claims) {
      const key = repoKey(developer) + '/' + id;
      if (!groups.has(key)) groups.set(key, { label, claims: [] });
      groups.get(key).claims.push(developer);
    }
  }
  const result = new Map();
  for (const group of groups.values()) {
    if (group.claims.length < 2) continue;
    const key = group.claims.map(item => item.assignmentId).sort().join('/');
    if (!result.has(key)) result.set(key, { developers: group.claims, labels: [] });
    result.get(key).labels.push(group.label);
  }
  return [...result.values()];
}

export function creatorActions(snapshot, scope = snapshot.developers) {
  const items = [];
  const included = new Set(scope.map(item => item.assignmentId));
  const add = (kind, developers, title, detail, provenance, sources, decision = null) => {
    if (!developers.some(item => included.has(item.assignmentId))) return;
    const links = [...new Set(sources.filter(sourceLink))];
    if (links.length) items.push({ kind, developers, title, detail, provenance, sources: links, decision });
  };
  const decisions = approvalQueue(snapshot).filter(item => item.state === 'requested' &&
    item.developer.reportFeedState !== 'unavailable');
  const rule = snapshot.directives.find(item => item.number === 509 && item.state === 'Creator source confirmed');
  for (const conflict of overlaps(snapshot.developers)) {
    add('ownership', conflict.developers, 'Resolve overlapping ownership claims',
      conflict.labels.join(' · '), 'Creator records', [...conflict.developers.map(item => item.ownership.source), rule?.source]);
  }
  for (const developer of scope) {
    const latest = latestFor(snapshot.reports, developer.assignmentId);
    const report = developer.head && latest?.commit === developer.head && developer.reportFeedState !== 'unavailable' ? latest : null;
    const pull = repoKey(developer) === 'hdog960/mythwrought' && developer.head && snapshot.pulls.find(item =>
      item.number === developer.pr && item.head === developer.head && item.state === 'open' && item.headRepositoryMatches === true);
    const requests = decisions.filter(item => item.developer.assignmentId === developer.assignmentId &&
      (item.category !== 'merge' || pull)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const distinct = new Set();
    for (const request of requests) {
      const { category, commit, id, action, reason, evidence } = request;
      const kind = ['merge', 'deployment'].includes(category) ? category : 'decision';
      const key = kind === 'decision' ? category + '/' + id : category + '/' + commit;
      if (distinct.has(key)) continue;
      distinct.add(key);
      add(kind, [developer], action, reason, 'Reported request', [request.report.source, evidence, pull?.source], request);
    }
    const failures = pull ? snapshot.checks.filter(check => check.number === pull.number && check.head === pull.head &&
      failedRequiredCheck(check)) : [];
    if (failures.length) {
      add('qualification', [developer], 'Review failed required checks',
        [...new Set(failures.map(item => item.title))].join(' · '), 'Verified GitHub checks', [...failures.map(item => item.source), pull.source]);
    }
    const blockers = (report?.blockers ?? []).filter(item => engineeringTypes.has(item.category) &&
      !(item.category === 'required CI failure' && failures.some(failure => failure.source === item.evidence)));
    if (blockers.length) {
      add('engineering', [developer], 'Review reported engineering blockers',
        [...new Set(blockers.map(item => item.description))].join(' · '), 'Reported at verified commit', [...blockers.map(item => item.evidence), report.source]);
    }
    const milestones = report?.roadmap?.milestones.filter(item => item.kind === 'development') ?? [];
    const implementationComplete = milestones.length ? milestones.every(item => item.complete) :
      report?.completed?.length && report.remaining?.length === 0;
    if (pull && report?.releaseReadiness === 'integration' && implementationComplete &&
        !requests.length && !blockers.length && !failures.length && !developer.deferred && !developer.releaseHold &&
        !snapshot.dependencies.some(edge => edge.assignment === developer.assignmentId && edge.state === 'required')) {
      add('integration', [developer], 'Review implementation for integration', `Open PR #${pull.number}`,
        'Reported completion and verified PR', [pull.source, report.source]);
    }
    if (developer.ownership?.assignmentState === 'unassigned') {
      add('unassigned', [developer], 'Review a confirmed unassigned developer', developer.name,
        'Creator record', [developer.ownership.source]);
    }
  }
  const heldAssignments = new Set(items.filter(item => ['ownership', 'qualification'].includes(item.kind))
    .flatMap(item => item.developers.map(developer => developer.assignmentId)));
  for (const item of items) {
    if (['merge', 'deployment'].includes(item.kind)) {
      const developer = item.developers[0];
      item.approvalHeld = developer.releaseHold === true || heldAssignments.has(developer.assignmentId) ||
        snapshot.dependencies.some(edge => edge.assignment === developer.assignmentId && edge.state === 'required');
    }
  }
  return items.sort((a, b) => actionGroups[a.kind].rank - actionGroups[b.kind].rank ||
    (a.developers[0].priority ?? Infinity) - (b.developers[0].priority ?? Infinity) ||
    a.developers[0].project.localeCompare(b.developers[0].project));
}
