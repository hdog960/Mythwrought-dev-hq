import { estimateFor, latestFor } from './model.mjs';

const kinds = ['development', 'qualification'];

export function roadmapProgress(reports, assignmentId) {
  const history = reports.filter(item => item.assignmentId === assignmentId)
    .sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt) || a.reportId.localeCompare(b.reportId));
  const latest = history.at(-1);
  const plan = history.findLast(item => item.roadmap)?.roadmap;
  if (!plan || (latest.roadmapRevision && latest.roadmapRevision !== plan.revision)) return null;

  const planned = new Map(plan.milestones.map(item => [item.id, item]));
  const compatible = new Map();
  for (const { roadmap } of history) {
    if (!roadmap) continue;
    const unchanged = roadmap.milestones.every(milestone => {
      const current = planned.get(milestone.id);
      return current?.kind === milestone.kind && current.effort === milestone.effort;
    });
    const sameScope = roadmap.revision !== plan.revision || roadmap.milestones.length === plan.milestones.length;
    compatible.set(roadmap.revision, (compatible.get(roadmap.revision) ?? true) && unchanged && sameScope);
  }
  if (!compatible.get(plan.revision)) return null;
  const target = item => item.roadmapRevision ?? item.roadmap?.revision;
  const confirmed = new Set(history.filter(item => target(item) === plan.revision).flatMap(item => item.newlyCompleted ?? []));
  return { ...plan, milestones: plan.milestones.map(item => ({ ...item, complete: item.complete || confirmed.has(item.id) })),
    compatibleHistory: history.filter(item => compatible.get(target(item))) };
}

export function remainingSessions(reports, assignmentId) {
  const latest = latestFor(reports, assignmentId);
  const fallback = estimateFor(latest);
  const reported = fallback && { ...fallback, method: 'Developer report' };
  const progress = roadmapProgress(reports, assignmentId);
  if (!progress) return reported;

  const planned = new Map(progress.milestones.map(item => [item.id, item]));
  const counted = new Set();
  const credit = Object.fromEntries(kinds.map(kind => [kind, new Map()]));
  for (const report of progress.compatibleHistory) {
    const sessions = credit[report.outcome];
    if (!sessions || !report.sessionId || report.newlyCompleted == null) continue;
    let effort = sessions.get(report.sessionId) ?? 0;
    for (const id of report.newlyCompleted) {
      const milestone = planned.get(id);
      if (!milestone || milestone.kind !== report.outcome || counted.has(id)) continue;
      effort += milestone.effort;
      counted.add(id);
    }
    sessions.set(report.sessionId, effort);
  }

  const loads = kinds.map(kind => ({
    kind,
    effort: progress.milestones.filter(item => item.kind === kind && !item.complete).reduce((sum, item) => sum + item.effort, 0),
    samples: [...credit[kind].values()].slice(-8).sort((a, b) => a - b),
  })).filter(item => item.effort > 0);

  if (loads.length === 0) {
    return latest.releaseReadiness === 'fully accepted' ? { optimistic: 0, likely: 0, conservative: 0,
      confidence: 'high', rationale: `All milestones in ${progress.revision} are complete and the latest report records full acceptance.`,
      method: 'Reported milestone throughput' } : (reported?.likely ? reported : null);
  }
  if (loads.some(({ samples }) => samples.length < 3 || quantile(samples, .25) <= 0)) return reported?.likely ? reported : null;

  const effortAt = percentile => Math.ceil(loads.reduce((effort, item) => effort + item.effort / quantile(item.samples, percentile), 0));
  const optimistic = effortAt(.75);
  const likely = effortAt(.5);
  const conservative = effortAt(.25);
  const sampleSize = Math.min(...loads.map(item => item.samples.length));
  const samplesUsed = loads.map(({ kind, samples }) => `${samples.length} ${kind}`).join(' and ');
  return { optimistic, likely, conservative,
    confidence: sampleSize >= 6 && conservative <= optimistic * 2 ? 'medium' : 'low',
    rationale: `Revision ${progress.revision}. Based on the recorded effort of remaining milestones and ${samplesUsed} documented sessions from compatible revisions. This measures work sessions. Dependency wait time is tracked separately.`,
    method: 'Reported milestone throughput' };
}

function quantile(values, fraction) {
  const sample = (values.length - 1) * fraction;
  const lower = Math.floor(sample);
  return values[lower] + (values[Math.ceil(sample)] - values[lower]) * (sample - lower);
}
