import { remainingSessions, roadmapProgress } from './estimates.mjs';
import { cyclesIn, latestFor } from './model.mjs';

export function masterRoadmap(snapshot, scope = snapshot.developers) {
  const programs = new Map(snapshot.developers.map(developer => {
    const report = latestFor(snapshot.reports, developer.assignmentId);
    const plan = roadmapProgress(snapshot.reports, developer.assignmentId);
    const estimate = remainingSessions(snapshot.reports, developer.assignmentId);
    return [developer.assignmentId, { developer, report, plan, estimate }];
  }));
  const selected = scope.map(developer => programs.get(developer.assignmentId)).filter(Boolean);
  const selectedPlans = selected.filter(item => item.plan);
  const milestones = selectedPlans.flatMap(item => item.plan.milestones);
  const required = snapshot.dependencies.filter(edge => edge.state === 'required');
  const byProject = new Map();
  for (const edge of required) {
    if (!byProject.has(edge.assignment)) byProject.set(edge.assignment, []);
    byProject.get(edge.assignment).push(edge);
  }

  const reachable = new Set();
  function visit(assignment) {
    if (reachable.has(assignment)) return;
    reachable.add(assignment);
    for (const edge of byProject.get(assignment) ?? []) visit(edge.prerequisite);
  }
  selected.forEach(({ developer }) => visit(developer.assignmentId));
  const edges = snapshot.dependencies.filter(edge => reachable.has(edge.assignment));
  const cycles = cyclesIn(edges);
  const pressure = new Map();
  for (const edge of edges.filter(item => item.state === 'required')) {
    if (!pressure.has(edge.prerequisite)) pressure.set(edge.prerequisite, []);
    pressure.get(edge.prerequisite).push(edge);
  }
  const bottlenecks = [...pressure].map(([assignmentId, blockers]) => ({
    program: programs.get(assignmentId), assignmentId, edges: blockers,
  })).sort((a, b) => b.edges.length - a.edges.length ||
    (a.program?.developer.project ?? a.assignmentId).localeCompare(b.program?.developer.project ?? b.assignmentId));

  const chainMembers = new Set(edges.filter(edge => edge.state === 'required').flatMap(edge => [edge.assignment, edge.prerequisite]));
  const recorded = new Set(edges.map(edge => edge.id));
  const timeKnown = !cycles.length && edges.every(edge => ['resolved', 'required'].includes(edge.state)) &&
    [...chainMembers].every(id => programs.get(id)?.estimate != null &&
      !programs.get(id).report?.dependencyIds?.some(dependency => !recorded.has(dependency)));
  const memo = new Map();
  function pathFrom(id) {
    if (memo.has(id)) return memo.get(id);
    const own = programs.get(id);
    const children = (byProject.get(id) ?? []).map(edge => ({ ...pathFrom(edge.prerequisite), edge }))
      .sort((a, b) => b.sessions - a.sessions);
    const best = children[0];
    const path = { programs: [...(best?.programs ?? []), own],
      edges: best ? [...best.edges, best.edge] : [], sessions: (best?.sessions ?? 0) + own.estimate.likely };
    memo.set(id, path);
    return path;
  }
  const criticalPath = timeKnown && bottlenecks.length ? selected.filter(item => byProject.has(item.developer.assignmentId))
    .map(item => pathFrom(item.developer.assignmentId))
    .filter(item => item.edges.length).sort((a, b) => b.sessions - a.sessions)[0] ?? null : null;

  return {
    programs: selected, planCount: selectedPlans.length, completed: milestones.filter(item => item.complete).length,
    milestoneCount: milestones.length, edges, cycles, bottlenecks, criticalPath,
  };
}
