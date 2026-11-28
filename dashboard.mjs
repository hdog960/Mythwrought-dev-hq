import { actions, badge, el, link, list, muted, panel, row, rows, short, time } from './ui.mjs';
import { blockerSummary, developerWork, workflowBuckets, workLabels, workStates, workflowLabels } from './operations.mjs';
import { prerequisiteName } from './model.mjs';

const tones = { running: 'green', queued: 'blue', waiting: 'gold', blocked: 'red', complete: 'green', failed: 'red' };
const developerLink = developer => link(developer.name, '#developers/' + developer.id);

function count(label, value) {
  return el('div', 'activity-count', el('span', 'muted', label), el('strong', '', value == null ? 'Unknown' : String(value)));
}

export function workloadPanel(snapshot, developers, { expanded = false } = {}) {
  const github = workflowBuckets(snapshot);
  const observed = developerWork(snapshot, developers);
  const knownAuto = observed.filter(item => item.developer.category === 'automatic' && item.report?.execution && !item.stale);
  const grouped = new Map(workStates.map(state => [state, observed.filter(item => item.state === state)]));
  const gh = el('div', 'activity-counts', github.map(item => count(item.label, item.total)));
  const auto = knownAuto.length ? el('div', 'activity-counts', ['queued', 'running'].map(state =>
    count(workLabels[state], knownAuto.filter(item => item.report.execution.state === state).length))) : muted('Queued and running are unknown. Awaiting verified automation run reports.');
  const timed = github.filter(item => item.observedAt);
  const sharedObservation = timed.length === github.length &&
    timed.every(item => item.observedAt === timed[0].observedAt && !item.preserved);
  const timing = sharedObservation ? el('p', 'row-meta', 'Observed ', time(timed[0].observedAt))
    : timed.length ? el('p', 'row-meta', timed.map(item =>
      el('span', 'activity-as-of', item.label + ' · ', time(item.observedAt), item.preserved ? ' · Last available' : ''))) : null;
  return panel('Congestion', [
    el('h3', '', 'GitHub workflow runs'), muted('Repository-wide totals from the published snapshot.'),
    gh, timing,
    el('h3', '', 'Automatic developer runs'), auto,
    knownAuto.length ? muted(`${knownAuto.length} automation assignments with recent reported run status.`) : null,
    expanded ? [
      el('h3', '', 'Developer status'),
      observed.length ? [...grouped].filter(([, items]) => items.length).map(([state, items]) =>
        el('details', 'activity-group', el('summary', '', `${workLabels[state]} · ${items.length}`),
          rows(items.map(item => row(developerLink(item.developer),
            [item.stale ? 'Older observation · ' : item.report ? 'Verified report · '
              : ['paused', 'recorded'].includes(item.state) ? 'Scheduler observed · ' : 'Awaiting verified report',
              item.report ? link(time(item.observedAt), item.source)
                : ['paused', 'recorded'].includes(item.state) ? time(item.observedAt) : null,
              item.relatedWorkflow ? el('div', '', link(`Linked GitHub run · ${workflowLabels[item.relatedWorkflow.status]}`, item.relatedWorkflow.source)) : null],
            badge(workLabels[item.state], tones[item.state])))))) : muted('No assignments match this account filter.'),
      el('h3', '', 'GitHub workflow details'),
      github.map(item => el('details', 'activity-group',
        el('summary', '', `${item.label} · ${item.total ?? 'Unknown'}`),
        item.runs.length ? rows(item.runs.map(run => row(link(run.title, run.source), [run.branch ?? 'Branch unknown', ' · ', short(run.head)], badge(item.label, item.status === 'in_progress' ? 'green' : '')))) :
          muted(item.total === 0 ? 'No matching workflow runs in this snapshot.' : 'Workflow run details unavailable.'),
        item.total > item.runs.length && item.runs.length ? muted(`Showing ${item.runs.length} of ${item.total} runs.`) : null)),
    ] : actions(link('View status breakdown', '#more/congestion', 'button')),
  ], { iconName: 'signal', tone: 'workload-panel' });
}

export function blockersPanel(snapshot, developers, expanded = false) {
  const { entries, dependencies, reporting } = blockerSummary(snapshot, developers);
  const shown = expanded ? entries : entries.slice(0, 3);
  const constraints = expanded ? dependencies : dependencies.slice(0, 2);
  const followUps = developers.filter(item => item.lastSchedulerResult?.needsCreatorAction);
  return panel('Blockers', [
    muted(reporting ? `${reporting} / ${developers.length} assignments reported blocker status.` :
      'Developer blocker status is unknown until reports arrive.'),
    shown.length ? rows(shown.map(({ developer, item }) => row(link(item.description, item.evidence), [
      developerLink(developer), ' · ', item.category,
      item.owner ? el('div', '', `Owner · ${item.owner}`) : null,
      item.resolution ? el('div', '', `Next action · ${item.resolution}`) : null,
      item.detectedAt ? el('div', '', 'Detected ', time(item.detectedAt)) : null,
    ], badge('Reported blocker', 'red')))) : reporting ? muted('No confirmed blockers in the assignments that reported status.') : null,
    followUps.length ? el('div', 'constraints', el('h3', '', 'Automation follow-up'),
      list(followUps.map(developer => el('span', '', developerLink(developer), ' · Creator action requested in the last scheduler result')))) : null,
    constraints.length ? el('div', 'constraints', el('h3', '', 'Release constraints'), list(constraints.map(({ developer, edges }) => {
      const prerequisites = edges.map(edge => prerequisiteName(snapshot, edge.prerequisite));
      return el('span', '', developerLink(developer), ' · ', link(`Waiting for ${prerequisites.join(', ')}`, edges[0].source));
    }))) : null,
    expanded ? null : actions(link('Review blockers', '#more/blockers', 'button')),
  ], { iconName: 'warning' });
}
