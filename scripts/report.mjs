import { APPROVAL_TYPES, BLOCKER_TYPES, CATEGORIES, OUTCOMES, READINESS, REPO, isISO, isId,
  isRecord, isSha, sourceLink } from '../src/model.mjs';

const MAX_REPORT_BYTES = 16_384;
const marker = /^<!-- mythwrought-hq-report:v1 -->\r?\n```json\r?\n([\s\S]*?)\r?\n```$/gm;
const reserved = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:gh[pousr]_|github_pat_|xox[baprs]-|sk-(?:proj-)?)[\w-]{12,}|(?:\b(?:password|access[_ -]?token|secret[_ -]?key)\s*[:=]\s*\S)|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

export function publicText(value, max = 250) {
  if (typeof value !== 'string' || value.length > max || reserved.test(value)) return null;
  return value.trim() || null;
}

const requiredText = (value, max) => publicText(value, max) !== null;
const optional = test => value => value === null || test(value);
const list = (test, max = 30) => value => Array.isArray(value) && value.length <= max && value.every(test);
const oneOf = options => value => options.includes(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000;
const link = value => sourceLink(value) !== null;

function contract(value, fields) {
  return isRecord(value) && Object.keys(value).every(key => Object.hasOwn(fields, key))
    && Object.entries(fields).every(([key, test]) => Object.hasOwn(value, key) ? test(value[key]) : test(null));
}

function estimate(value) {
  return contract(value, {
    optimistic: duration, likely: duration, conservative: duration, confidence: oneOf(['high', 'medium', 'low']),
    rationale: text => requiredText(text, 600),
  }) && value.optimistic <= value.likely && value.likely <= value.conservative;
}

const blocker = value => contract(value, {
  id: isId, category: oneOf(BLOCKER_TYPES), description: text => requiredText(text, 600),
  owner: optional(isId), detectedAt: isISO, evidence: link,
  resolution: optional(text => requiredText(text, 600)),
});

const decision = value => contract(value, {
  id: isId, category: oneOf(APPROVAL_TYPES), action: text => requiredText(text, 250),
  reason: text => requiredText(text, 600), commit: optional(isSha), evidence: optional(link),
  limitations: optional(text => requiredText(text, 350)), affected: optional(list(isId)),
  requestedAt: isISO, state: oneOf(['requested', 'authorized', 'declined']),
});

const evidence = value => contract(value, {
  id: isId, commit: isSha, source: link, suite: text => requiredText(text, 160),
  outcome: oneOf(['success', 'failure', 'pending', 'unknown']),
  scope: optional(text => requiredText(text, 250)), environment: optional(text => requiredText(text, 160)),
  artifactId: optional(value => Number.isSafeInteger(value) && value > 0), artifactHash: optional(value => /^sha256:[a-f0-9]{64}$/.test(value)),
  workflowId: optional(value => Number.isSafeInteger(value) && value > 0),
  invalidation: optional(text => requiredText(text, 250)),
});

const quantity = value => contract(value, {
  id: isId, unit: text => requiredText(text, 80), state: oneOf(['planned', 'implemented', 'qualified', 'merged', 'released', 'provisional', 'rejected']),
  amount: count, target: optional(count),
});

const milestone = value => contract(value, {
  id: isId, label: text => requiredText(text, 160), effort: value => duration(value) && value >= .1,
  kind: oneOf(['development', 'qualification']), complete: value => typeof value === 'boolean',
});
const roadmap = value => contract(value, {
  revision: isId, milestones: list(milestone, 60),
}) && value.milestones.length > 0 && new Set(value.milestones.map(item => item.id)).size === value.milestones.length;

export const fields = {
  schemaVersion: value => value === 1, publish: value => value === true, reportId: isId,
  developerId: isId, assignmentId: isId, category: oneOf(CATEGORIES), sessionId: isId, reportedAt: isISO,
  repository: value => typeof value === 'string' && REPO.test(value),
  branch: value => typeof value === 'string' && /^[A-Za-z0-9][-.\w/]{0,159}$/.test(value) && !value.includes('..'),
  commit: isSha, pull: optional(value => count(value) && value > 0), issue: optional(value => count(value) && value > 0),
  checkpoint: optional(link),
  outcome: oneOf(OUTCOMES), completed: optional(list(value => requiredText(value, 400), 20)),
  milestone: optional(isId), roadmapRevision: optional(isId), roadmap: optional(roadmap), newlyCompleted: optional(list(isId)), quantitative: optional(list(quantity)),
  remaining: optional(list(value => requiredText(value, 400), 20)), estimate: optional(estimate),
  blockers: optional(list(blocker)), dependencyIds: optional(list(isId)),
  qualification: optional(list(evidence)), reusableEvidence: optional(list(evidence)),
  decisions: optional(list(decision)), nextObjective: optional(value => requiredText(value, 600)),
  continuation: optional(value => requiredText(value, 2_000)), releaseReadiness: optional(oneOf(READINESS)),
};

export function parseReport(body, assignment, registeredSource, comment) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_REPORT_BYTES
      || !registeredSource.publishers.includes(comment.publisher)) return null;
  const matches = [...body.matchAll(marker)];
  if (matches.length !== 1) return null;
  let payload;
  try { payload = JSON.parse(matches[0][1]); } catch { return null; }
  if (!contract(payload, fields) || payload.developerId !== assignment.id || payload.assignmentId !== assignment.assignmentId ||
      payload.category !== assignment.category || payload.repository.toLowerCase() !== assignment.repository.toLowerCase() ||
      (assignment.pr !== null && payload.pull !== assignment.pr) || (assignment.branch && payload.branch !== assignment.branch) ||
      !isISO(comment.createdAt) || Date.parse(payload.reportedAt) > Date.parse(comment.createdAt) + 5 * 60_000) return null;
  if (payload.roadmap && payload.roadmapRevision && payload.roadmap.revision !== payload.roadmapRevision) return null;
  if ((payload.decisions ?? []).some(item => item.state !== 'requested' &&
      !registeredSource.creatorAuthorizationPublishers?.includes(comment.publisher))) return null;
  const source = sourceLink(comment.url);
  if (!source) return null;
  const clean = {};
  for (const key of Object.keys(fields)) {
    if (key !== 'publish') clean[key] = payload[key] ?? null;
  }
  return { ...clean, source, provenance: 'registered-public-comment' };
}

export function reportKey(report) {
  return `${report.assignmentId}:${report.reportId}`;
}

export function appendReports(previous, incorporated) {
  const seen = new Set(previous.map(reportKey));
  return previous.concat(incorporated.filter(report => {
    const key = reportKey(report);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })).sort((a, b) => a.reportedAt.localeCompare(b.reportedAt) || reportKey(a).localeCompare(reportKey(b)));
}
