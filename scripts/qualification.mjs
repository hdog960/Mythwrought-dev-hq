import { git, game } from '../config/sources.mjs';
import { failedRequiredCheck, isISO, sourceLink } from '../src/model.mjs';
import { publicText } from './report.mjs';

const gamePath = suffix => `/repos/${game}${suffix}`;
const positive = value => Number.isSafeInteger(value) && value > 0;
const date = value => isISO(value) ? value : null;
const checkPasses = row => row.status === 'completed' && ['success', 'neutral', 'skipped'].includes(row.conclusion);

export async function requiredChecks(base, detail) {
  if (!base) return { rules: [], complete: false };
  const branch = encodeURIComponent(base);
  const [legacy, rules] = await Promise.allSettled([
    detail(gamePath(`/branches/${branch}/protection/required_status_checks`)),
    detail(gamePath(`/rules/branches/${branch}`)),
  ]);
  const protection = legacy.status === 'fulfilled' ? legacy.value : null;
  const legacyRules = Array.isArray(protection?.checks) && protection.checks.length ? protection.checks :
    Array.isArray(protection?.contexts) ? protection.contexts.map(context => ({ context })) : null;
  const activeRules = rules.status === 'fulfilled' && Array.isArray(rules.value) ? rules.value : null;
  const ruleChecks = activeRules?.filter(rule => rule?.type === 'required_status_checks')
    .map(rule => rule.parameters?.required_status_checks);
  const contexts = (legacyRules ?? []).concat((ruleChecks ?? []).flatMap(rows => Array.isArray(rows) ?
    rows.map(row => ({ context: row?.context, app_id: row?.integration_id })) : []));
  const valid = contexts.filter(row => publicText(row?.context));
  return { rules: valid, complete: Boolean(legacyRules && ruleChecks?.every(Array.isArray) && valid.length === contexts.length) };
}

export function qualificationInventory(head, pages) {
  return Promise.allSettled([
    pages(gamePath(`/commits/${head}/check-runs?filter=latest`), { unwrap: data => data.check_runs }),
    pages(gamePath(`/commits/${head}/status`), { unwrap: data => data?.sha === head ? data.statuses : null }),
  ]);
}

function normalize(row, kind, candidate, requirement) {
  const title = publicText(kind === 'status' ? row?.context : row?.name);
  if (!positive(row?.id) || !title || (kind === 'check' && row.head_sha !== candidate.head)) return null;
  const sameName = requirement.rules.filter(rule => rule.context === title);
  const qualified = sameName.some(rule => !positive(rule.app_id) || (kind === 'check' && rule.app_id === row.app?.id));
  const status = kind === 'status' ? row.state : row.status;
  if (kind === 'status' && !['pending', 'success', 'failure', 'error'].includes(status)) return null;
  return {
    id: row.id, kind, number: candidate.number, title, head: candidate.head,
    status: kind === 'status' ? status === 'pending' ? 'pending' : 'completed' : publicText(status, 40),
    conclusion: kind === 'status' ? status === 'pending' ? null : status : publicText(row.conclusion, 40),
    mandatory: qualified ? true : requirement.complete && !(kind === 'status' && sameName.length) ? false : null,
    updatedAt: date(kind === 'status' ? row.updated_at ?? row.created_at : row.completed_at ?? row.started_at),
    source: sourceLink(kind === 'status' ? row.target_url : row.html_url) ?? git(game, `/pull/${candidate.number}/checks`),
    appId: kind === 'check' ? row.app?.id : null,
  };
}

export function reconcileQualification(candidate, requirement, inventory, prior = []) {
  const kinds = ['check', 'status'];
  const statuses = new Map();
  let complete = requirement.complete;
  let readable = 0;
  const observations = inventory.flatMap((result, index) => {
    const kind = kinds[index];
    if (result.status === 'rejected') {
      complete = false;
      return prior.filter(item => (item.kind ?? 'check') === kind && item.number === candidate.number &&
        item.head === candidate.head).map(item => ({ ...item, mandatory: null, preserved: true }));
    }
    readable++;
    if (result.value.limited) complete = false;
    const items = result.value.items.map(row => normalize(row, kind, candidate, requirement));
    if (items.some(row => row === null)) complete = false;
    const valid = items.filter(Boolean);
    if (kind === 'check') return valid;
    // The Combined Status API supplies the latest value per context. Collapse
    // overlaps between pages by observation time, then by monotonically increasing ID.
    for (const row of valid) {
      const previous = statuses.get(row.title);
      if (!previous || (row.updatedAt ?? '') > (previous.updatedAt ?? '') ||
          (row.updatedAt === previous.updatedAt && row.id > previous.id)) statuses.set(row.title, row);
    }
    return [...statuses.values()];
  });
  const current = observations.filter(row => !row.preserved);
  const failure = current.find(failedRequiredCheck);
  const pending = current.find(row => row.mandatory === true && ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(row.status));
  const unmet = requirement.rules.filter(rule => {
    const matches = current.filter(row => row.title === rule.context);
    const checkMatch = matches.some(row => row.kind === 'check' && (!positive(rule.app_id) || row.appId === rule.app_id) && checkPasses(row));
    const legacy = matches.find(row => row.kind === 'status');
    // GitHub requires both result types when a required context name appears in
    // both feeds. The legacy API does not identify a publisher's GitHub App ID.
    return legacy ? (positive(rule.app_id) || !checkPasses(legacy) ||
      (matches.some(row => row.kind === 'check') && !checkMatch)) : !checkMatch;
  });
  const gate = failure ? { state: 'failed', source: failure.source } : pending ? { state: 'pending', source: pending.source } :
    { state: complete && !unmet.length ? 'clear' : 'unavailable', source: candidate.source };
  return { checks: observations.map(({ appId, ...row }) => row), complete, readable, gate };
}
