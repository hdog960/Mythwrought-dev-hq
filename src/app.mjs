import { approvalQueue, cyclesIn, freshState, isSnapshot, latestFor } from './model.mjs';
import { actions, badge, button, el, fields, header, icon, link, list, muted, panel, readLocal, row, rows, saveLocal, short, time } from './ui.mjs';
import { remainingSessions, roadmapProgress } from './estimates.mjs';
import { ideasPage } from './ideas.mjs';
import { congestion, summarize } from './insights.mjs';

const routes = [
  ['home', 'Home', 'home'], ['developers', 'Developers', 'users'], ['roadmap', 'Roadmap', 'map'],
  ['inbox', 'Creator Inbox', 'inbox'], ['more', 'More', 'more'],
];
const moreRoutes = [
  ['coverage', 'Reporting coverage', 'Source freshness, synchronization, and onboarding'],
  ['activity', 'GitHub activity', 'Open PRs, recently closed PRs, workflows, and issues'],
  ['releases', 'Release center', 'Public production identity and GitHub deployment history'],
  ['evidence', 'Evidence vault', 'Exact-commit checks and reported qualification'],
  ['history', 'Development history', 'Reported work, milestones, and creator briefings'],
  ['directives', 'Creator directives', 'Standing rules and protected ownership'],
  ['ideas', 'Idea Vault', 'Local ideas and roadmap proposals'],
];
const categoryName = { manual: 'Manual', automatic: 'Automatic', codex: 'Codex' };
const categoryTone = { manual: 'blue', automatic: 'green', codex: 'purple' };
const statusTone = { 'Release hold': 'orange', 'Merge embargo': 'red', 'Report connected': 'green' };
const sourceNames = { branches: 'Game main reference', pulls: 'Pull requests', issues: 'Issues', workflows: 'Workflows',
  releases: 'GitHub releases', deployments: 'Pages deployments', production: 'Public release identity',
  directives: 'Creator directives', registeredBranches: 'Registered branch HEADs', checks: 'Exact-commit checks', reports: 'Developer reports' };
const nav = document.querySelector('#navigation');
const main = document.querySelector('#main');
const health = document.querySelector('#health');
const notice = document.querySelector('#notice');
const refresh = document.querySelector('#refresh');
const toast = document.querySelector('#toast');
const dataURL = new URL('./data/snapshot.json', location.href).href;
const dataCache = 'mythwrought-hq-data-v1';
let snapshot = null;
let cached = false;
let loading = false;
let loadError = false;
let filter = 'all';
let focus = readLocal('focus', false) === true;
let activePath = null;
let toastTimer;
let pendingWorker = null;

for (const [id, name, pictogram] of routes) {
  const item = link([icon(pictogram), el('span', '', name)], '#' + id, 'nav-item');
  item.dataset.route = id;
  nav.append(item);
}
refresh.append(icon('refresh'));
refresh.addEventListener('click', () => load(true));
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  render(true);
});
window.addEventListener('online', () => load());
window.addEventListener('offline', () => {
  renderStatus();
  if (activePath === 'inbox') render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { load(); checkUpdates(); }
});
setInterval(() => { if (!document.hidden) { load(); checkUpdates(); } }, 10 * 60_000);

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    notify(message);
  } catch {
    notify('Clipboard unavailable. Open the source or select and copy the text.');
  }
}

function renderStatus() {
  const offline = !navigator.onLine;
  const state = freshState(snapshot);
  const label = offline ? 'Offline' : cached ? 'Cached snapshot' : state;
  health.textContent = loading && !snapshot ? 'Loading snapshot' : label;
  health.className = 'health-pill ' + (label === 'Published snapshot' ? 'ready' : 'caution');
  notice.hidden = !pendingWorker && !(snapshot && (offline || cached || state === 'Stale snapshot'));
  notice.replaceChildren();
  if (pendingWorker) notice.append(button('Install HQ update', () => pendingWorker.postMessage('activate-hq-update')));
  if (snapshot && (offline || cached || state === 'Stale snapshot')) {
    notice.append(el('p', '', 'Showing evidence from ', time(snapshot.generatedAt), '.'));
  }
}

async function load(manual = false) {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  renderStatus();
  const former = snapshot;
  const priorError = loadError;
  try {
    if (!navigator.onLine) throw new Error('Offline');
    const response = await fetch(dataURL, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Snapshot unavailable');
    const body = await response.text();
    if (body.length > 8_000_000) throw new Error('Snapshot exceeds size limit');
    const next = JSON.parse(body);
    if (!isSnapshot(next)) throw new Error('Invalid snapshot');
    if (!snapshot || next.generatedAt >= snapshot.generatedAt) {
      snapshot = next;
      cached = false;
      try {
        const cache = await caches.open(dataCache);
        await cache.put(dataURL, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      } catch { /* The valid in-memory snapshot remains available. */ }
    }
    loadError = false;
    if (manual) notify('Published snapshot checked');
  } catch {
    try {
      const response = await (await caches.open(dataCache)).match(dataURL);
      const data = await response?.json();
      if (isSnapshot(data) && (!snapshot || data.generatedAt >= snapshot.generatedAt)) snapshot = data;
    } catch { /* Cache unavailable. */ }
    cached = Boolean(snapshot);
    loadError = true;
    if (manual) notify(cached ? 'Using last validated snapshot' : 'Published snapshot unavailable');
  } finally {
    loading = false;
    refresh.disabled = false;
    renderStatus();
    const editingIdeas = activePath === 'more/ideas';
    if (!editingIdeas && (activePath === null || former?.generatedAt !== snapshot?.generatedAt || loadError !== priorError)) render();
  }
}

async function checkUpdates() {
  try {
    if (!('serviceWorker' in navigator)) return;
    (await navigator.serviceWorker.getRegistration())?.update().catch(() => {});
  } catch { /* A manual refresh may still load the site. */ }
}

function setupWorker() {
  if (!('serviceWorker' in navigator)) return;
  let alreadyControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (alreadyControlled && pendingWorker) location.reload();
    alreadyControlled = true;
  });
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const waiting = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        pendingWorker = registration.waiting;
        renderStatus();
      }
    };
    waiting();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', waiting));
  }).catch(() => {});
}

const developerLink = (developer, label = developer.project, klass) => link(label, '#developers/' + developer.id, klass);
const reportFor = developer => latestFor(snapshot.reports, developer.assignmentId);
const verifiedCount = () => snapshot.developers.filter(reportFor).length;
const coverageOf = field => snapshot.developers.filter(developer => Array.isArray(reportFor(developer)?.[field])).length;
const reportStatus = developer => developer.status !== 'Unknown' ? developer.status
  : reportFor(developer) ? 'Report connected' : developer.status;
const statusBadge = developer => badge(reportStatus(developer), statusTone[reportStatus(developer)]);
const labelFor = category => categoryName[category] ?? category;

function stat(label, value, description, symbol) {
  return el('div', 'stat', el('div', 'stat-title', icon(symbol), label),
    el('div', 'stat-value', value), el('p', 'stat-caption', description));
}

function productionPanel() {
  const production = snapshot.production;
  const deployment = snapshot.deployments.find(item => item.state === 'success' && item.target);
  return panel('Production', [
    fields([['Public build', production.version ?? 'Unknown'],
      ['Observed', time(production.observedAt)],
      ['Latest successful public Pages deployment', deployment ? link(short(deployment.head), deployment.source) : 'Unknown']]),
    actions(link('Release center', '#more/releases', 'button')),
  ], { iconName: 'globe' });
}

function home() {
  const queue = approvalQueue(snapshot);
  const pressure = congestion(snapshot);
  const verified = verifiedCount();
  const total = snapshot.developers.length;
  const decisionsKnown = coverageOf('decisions');
  const blockersKnown = coverageOf('blockers');
  const first = queue[0];
  const blockers = snapshot.developers.flatMap(developer => (reportFor(developer)?.blockers ?? [])
    .filter(item => !['CI waiting', 'deferral'].includes(item.category)).map(blocker => ({ developer, blocker })));
  const reports = snapshot.reports.filter(item => item.outcome === 'development').slice(-4).reverse();
  const lanes = ['unified', 'beasts', 'builder', 'hq'].map(id => snapshot.developers.find(item => item.id === id)).filter(Boolean);
  const focusButton = button(focus ? 'Exit Focus Mode' : 'Focus Mode', () => {
    focus = !focus;
    saveLocal('focus', focus);
    render();
  });
  focusButton.prepend(icon('focus'));
  const logo = el('img');
  Object.assign(logo, { src: './assets/icon-512.png', alt: '' });
  const hero = el('section', 'hero',
    el('div', 'hero-copy', el('h1', '', focus ? 'Creator focus' : 'Development overview'),
      el('p', '', 'See project status, creator decisions, and release evidence for Mythwrought.'),
      actions(focusButton)), el('div', 'hero-emblem', logo));
  const cards = el('div', 'stats',
    stat('Developer roster', String(total), `${verified} ${verified === 1 ? 'source' : 'sources'} with verified reports`, 'users'),
    stat('Creator decisions', queue.length || decisionsKnown ? String(queue.length) : 'Unknown',
      decisionsKnown ? `${decisionsKnown} / ${total} report decision status` : 'Awaiting decision status', 'inbox'),
    stat('Reported blockers', blockersKnown ? String(new Set(blockers.map(entry => entry.blocker.id)).size) : 'Unknown',
      blockersKnown ? `${blockersKnown} / ${total} report blocker status` : 'Awaiting blocker status', 'warning'),
    stat('Congestion', pressure.score === null ? 'Unknown' : String(pressure.score), pressure.coverage ?
      `${pressure.coverage}% evidence coverage` : 'Coverage needed for a score', 'signal'));
  const nextAction = panel('Creator action', [el('h3', '', first?.action ??
    (verified < snapshot.developers.length ? 'Confirm developer reporting' : 'Review reporting coverage')),
    muted(first?.reason ?? 'Connect registered checkpoints to surface developer progress, blockers, and decisions.'),
    actions(link(first ? 'Open Creator Inbox' : 'View reporting coverage', first ? '#inbox' : '#more/coverage', 'button gold'))],
  { iconName: 'inbox', tone: 'gold-panel creator-action' });
  const priority = panel('Project checkpoints', rows(lanes.map(developer => el('div', 'row lane',
    el('span', 'lane-mark ' + developer.category),
    el('div', 'row-main', developerLink(developer), el('span', 'row-meta', [labelFor(developer.category), developer.name,
      developer.priority === 1 ? 'Creator priority' : null, developer.deferred ? 'Deferred per brief' : null].filter(Boolean).join(' · '))),
    el('div', 'row-side', statusBadge(developer))))),
  { iconName: 'branch', end: link('All developers', '#developers') });
  const outcomes = panel('Meaningful development', reports.length ? rows(reports.map(report => row(
    link(report.completed?.[0] ?? 'Development session', report.source), time(report.reportedAt), badge('Verified report', 'green'))))
    : muted('Waiting for a verified development session report.'), { iconName: 'bolt' });
  const blockerPanel = panel('Critical blockers', blockers.length ? list(blockers.map(({ developer, blocker }) =>
    el('span', '', developerLink(developer), ' · ', link(blocker.description, blocker.evidence)))) :
    muted(blockersKnown ? 'No confirmed blockers in the reports that provided blocker status.' : 'Blocker status is currently unknown.'), { iconName: 'warning' });
  if (focus) return [hero, cards, el('div', 'main-grid', el('div', 'stack', nextAction, outcomes, blockerPanel),
    el('div', 'stack', panel('Decisions', queue.length ? list(queue.map(item => link(item.action, '#inbox'))) : muted(decisionsKnown ? 'No outstanding decisions in the reports that provided decision status.' : 'Decision status is currently unknown.')),
      panel('Development health', fields([['Reporting', `${verified} / ${snapshot.developers.length} verified`],
        ['Coverage status', freshState(snapshot)]]))))];
  return [hero, cards, el('div', 'main-grid home-grid', el('div', 'stack', priority, outcomes),
    el('div', 'stack', nextAction, productionPanel(), blockerPanel))];
}

function developerIndex() {
  const filterBar = el('div', 'filters', ...Object.entries({ all: 'All developers', ...categoryName }).map(([category, name]) => {
    const control = button(name, () => { filter = category; render(); }, 'filter');
    control.setAttribute('aria-pressed', String(filter === category));
    return control;
  }));
  const matches = snapshot.developers.filter(item => filter === 'all' || filter === item.category);
  return [header('Developers', 'Browse assignments and their source evidence.'), filterBar,
    el('div', 'cards', matches.map(developer => {
      const report = reportFor(developer);
      return el('article', 'panel', badge(labelFor(developer.category), categoryTone[developer.category]),
        developerLink(developer, developer.name, 'card-link'), el('p', '', developer.project),
        muted(report ? `Latest outcome · ${report.outcome}` : developer.authority), el('div', '', statusBadge(developer)));
    }))];
}

function developerDetail(id) {
  const developer = snapshot.developers.find(item => item.id === id);
  if (!developer) return [header('Developer unavailable', 'This assignment is missing from the published snapshot.')];
  const reports = snapshot.reports.filter(item => item.assignmentId === developer.assignmentId).slice().reverse();
  const report = reportFor(developer);
  const candidate = snapshot.pulls.find(pr => pr.number === developer.pr);
  const estimate = remainingSessions(snapshot.reports, developer.assignmentId);
  const registeredRoadmap = roadmapProgress(snapshot.reports, developer.assignmentId);
  const dependencies = snapshot.dependencies.filter(edge => edge.assignment === developer.assignmentId);
  const exact = Boolean(report && developer.head && report.commit === developer.head);
  const continuationControl = button('Continue Development', () => copy(report.continuation, `Checkpoint ${short(report.commit)} copied`), 'primary');
  continuationControl.disabled = !exact || !report.continuation;
  const outcome = report ? `${report.outcome} · ${report.releaseReadiness ?? 'Release readiness unknown'}` : 'No verified report';
  const progress = panel('Progress and next work', [
    fields([['Latest report', report ? time(report.reportedAt) : 'Unknown'], ['Outcome', outcome],
      ['Current milestone', report?.milestone], ['Next objective', report?.nextObjective],
      ['Optimistic sessions', estimate ? String(estimate.optimistic) : 'Unknown'],
      ['Likely sessions', estimate ? String(estimate.likely) : 'Unknown'],
      ['Conservative sessions', estimate ? String(estimate.conservative) : 'Unknown'],
      ['Estimate confidence', estimate?.confidence], ['Estimate source', estimate?.method]]),
    estimate && muted(estimate.rationale),
    registeredRoadmap ? el('details', '', el('summary', '', 'Roadmap revision ' + registeredRoadmap.revision),
      list(registeredRoadmap.milestones.map(item => `${item.label} · ${item.complete ? 'Complete' : 'Planned'} · ${item.kind}`))) : null,
    el('h3', '', 'Completed work'), list(report?.completed),
    el('h3', '', 'Remaining work'), list(report?.remaining),
    el('h3', '', 'Content progress'), list(report?.quantitative?.map(item =>
      `${item.amount}${item.target === null ? '' : ` / ${item.target}`} ${item.unit} · ${item.state}`)),
  ], { iconName: 'map' });
  const schedule = developer.category === 'automatic' ? panel('Automation reporting', [
    fields([['Roster slot', developer.minute === null ? 'Unknown' : `:${String(developer.minute).padStart(2, '0')} · creator brief`],
      ['Schedule timezone', developer.timezone], ['Last verified report', report && time(report.reportedAt)],
      ['Next expected run', 'Unknown'], ['Scheduler telemetry', 'Unavailable']]),
  ], { iconName: 'signal' }) : null;
  return [header(developer.name, developer.project, actions(link('All developers', '#developers', 'button'), statusBadge(developer))),
    el('div', 'main-grid', el('div', 'stack', progress, panel('Blockers and dependencies', [
      list(report?.blockers?.map(item => link(`${item.category} · ${item.description}`, item.evidence)), report && report.blockers ? 'No reported blockers' : 'Blocker status unknown'),
      list(dependencies.map(edge => link(`${snapshot.developers.find(dep => dep.assignmentId === edge.prerequisite)?.project ?? edge.prerequisite} · ${edge.scope} · ${edge.state}`, edge.source)), 'No registered dependencies'),
    ], { iconName: 'warning' }), panel('Session history', reports.length ? list(reports.map(item =>
      link([time(item.reportedAt), ` · ${item.outcome} · ${short(item.commit)}`], item.source))) : muted('No verified session reports.'))),
    el('div', 'stack', panel('Source checkpoint', [
      fields([['Priority', developer.priority === 1 ? 'Creator priority' : developer.deferred ? 'Deferred per brief' : developer.status === 'Deferred per brief' ? developer.status : null],
        ['Assignment source', developer.source ? link(developer.authority, developer.source) : developer.authority],
        ['Repository', developer.repository], ['Branch', developer.branch], ['Verified HEAD', developer.head ? el('code', '', developer.head) : 'Unknown'],
        ['Pull request', candidate ? link(`#${candidate.number} · ${candidate.draft ? 'Draft' : candidate.state}`, candidate.source)
          : report?.pull ? link(`#${report.pull}`, `https://github.com/${report.repository}/pull/${report.pull}`) : 'Unknown'],
        ['Report checkpoint', report ? link(short(report.commit), report.checkpoint ?? report.source) : 'Unknown']]),
      report && !exact ? muted('Checkpoint is stale or the current HEAD is unverified.') : null,
      actions(continuationControl, developer.pr ? link('View exact-commit checks', '#more/evidence/' + developer.id, 'button') : null),
      exact && report.continuation ? el('details', '', el('summary', '', 'View continuation prompt'), el('p', 'wrap-text', report.continuation)) : null,
    ], { iconName: 'branch' }), schedule))];
}

function roadmap() {
  const cycles = cyclesIn(snapshot.dependencies);
  const proposals = readLocal('ideas-v1', []);
  const localProposals = Array.isArray(proposals) ? proposals.filter(item => item?.proposal && !item.archived) : [];
  return [header('Roadmap', 'Project priorities, reported milestones, and release dependencies.'),
    el('div', 'main-grid', panel('Development programs', rows(snapshot.developers.map(developer => {
      const latest = reportFor(developer);
      const completed = [...new Set(snapshot.reports.filter(item => item.assignmentId === developer.assignmentId)
        .flatMap(item => item.newlyCompleted ?? []))];
      return row(developerLink(developer), [labelFor(developer.category),
        latest?.milestone ? ' · ' + latest.milestone : ' · Milestone unknown',
        completed.length ? ' · ' + completed.join(', ') : ''], statusBadge(developer));
    })), { iconName: 'map' }),
    el('div', 'stack', panel('Release dependencies', [
      list(snapshot.dependencies.map(edge => {
        const project = snapshot.developers.find(developer => developer.assignmentId === edge.assignment);
        const prerequisite = snapshot.developers.find(developer => developer.assignmentId === edge.prerequisite);
        return link(`${project?.project ?? edge.assignment} depends on ${prerequisite?.project ?? edge.prerequisite} · ${edge.state}`, edge.source);
      }), 'No registered dependencies'),
      cycles.length ? list(cycles.map(cycle => 'Circular dependency · ' + cycle)) : null,
    ], { iconName: 'branch' }),
    panel('Local proposals', list(localProposals.map(item => String(item.title)), 'No local proposals'), { end: link('Idea Vault', '#more/ideas') })))];
}

function inbox() {
  const queue = approvalQueue(snapshot);
  const cards = queue.map(item => {
    const canCopy = item.state === 'requested' && navigator.onLine && !cached && freshState(snapshot) !== 'Stale snapshot' &&
      (!item.commit || snapshot.health.sources.registeredBranches?.state === 'ok');
    const control = button('Copy authorization text', () => copy(
      `I authorize ${item.action}${item.commit ? ` at exact commit ${item.commit}` : ''} for ${item.developer.project}. Scope: ${item.reason}`,
      'Authorization text copied'), 'gold');
    control.disabled = !canCopy;
    return panel(item.action, [el('p', '', item.reason), fields([['Requested by', developerLink(item.developer)],
      ['Category', item.category], ['Commit', item.commit ?? 'Unknown'], ['Requested', time(item.requestedAt)],
      ['Limitations', item.limitations], ['Affected dependencies', item.affected?.join(', ') || 'Unknown'],
      ['Qualification evidence', item.evidence ? link('Open evidence', item.evidence) : 'Unknown']]),
      actions(link('Review on GitHub', item.report.source, 'button'), control)],
    { tone: 'gold-panel', iconName: 'inbox', end: badge(item.state, 'gold') });
  });
  return [header('Creator Inbox', 'Review requests here and authorize them through their registered GitHub workflow.'),
    el('div', 'stack', cards.length ? cards : panel('Decision requests',
      muted(coverageOf('decisions') ? 'No outstanding decisions in the reports that provided decision status.' : 'Decision status is currently unknown.'),
    { iconName: 'inbox', end: link('Reporting coverage', '#more/coverage') }))];
}

function coverage() {
  const statusBadges = { ok: 'green', partial: 'gold', error: 'red' };
  const healthData = snapshot.health;
  return [header('Reporting coverage', 'Public GitHub metadata and developer-submitted reports have separate coverage.'),
    el('div', 'main-grid', el('div', 'stack', panel('Synchronization', fields([
      ['Last collection attempt', time(healthData.lastAttempt)], ['Last usable core collection', time(healthData.lastSuccess)],
      ['Snapshot generated', time(snapshot.generatedAt)], ['Estimated next scheduled trigger', time(healthData.nextExpected)],
      ['GitHub quota remaining', healthData.rateLimit?.remaining === null ? 'Unknown' : String(healthData.rateLimit?.remaining ?? 'Unknown')],
      ['Game main', snapshot.mainHead ? el('code', '', snapshot.mainHead) : 'Unknown'],
    ]), { iconName: 'refresh' }),
    panel('Source health', rows(Object.entries(healthData.sources).map(([key, item]) => row(
      el('strong', '', sourceNames[key] ?? key), [time(item.lastSuccess), item.note && ' · ' + item.note],
      badge(item.state, statusBadges[item.state])))))),
    panel('Developer coverage', rows(snapshot.developers.map(developer => {
      const confirmed = reportFor(developer);
      const state = confirmed ? 'Connected and verified' : developer.registeredSources.length ? 'Awaiting verified report'
        : developer.status === 'Deferred per brief' ? 'Intentionally deferred' : 'Source unconfirmed';
      return row(developerLink(developer, developer.name),
        confirmed ? link('Open verified report', confirmed.source) : developer.authority,
        badge(state, confirmed && 'green'));
    })), { iconName: 'users' }))];
}

function activity() {
  const showPulls = (title, pulls) => panel(title, pulls.length ? rows(pulls.map(pr => row(
    link(`#${pr.number} · ${pr.title}`, pr.source), [pr.branch, ' · ', short(pr.head), ' · ', time(pr.updatedAt)],
    badge(pr.draft && pr.state === 'open' ? 'Draft' : pr.state, pr.state === 'merged' ? 'green' : 'blue')))) : muted('No items in the published window.'));
  return [header('GitHub activity', 'Recent repository evidence from the published synchronization window.'),
    el('div', 'main-grid', el('div', 'stack',
      showPulls('Open pull requests', snapshot.pulls.filter(pr => pr.state === 'open').slice(0, 20)),
      showPulls('Recently closed pull requests', snapshot.pulls.filter(pr => pr.state !== 'open').slice(0, 15))),
    el('div', 'stack', panel('Recent workflow runs', rows(snapshot.workflows.slice(0, 15).map(run =>
      row(link(run.title, run.source), [short(run.head), ' · ', time(run.updatedAt)],
        badge(run.conclusion ?? run.status ?? 'Unknown', run.conclusion === 'success' ? 'green' : ''))))),
    panel('Recent issues', rows(snapshot.issues.slice(0, 12).map(item =>
      row(link(`#${item.number} · ${item.title}`, item.source), time(item.updatedAt), badge(item.state)))))))];
}

function releases() {
  return [header('Release center', 'Published game identity and GitHub deployment evidence.'),
    el('div', 'main-grid', el('div', 'stack', panel('Current public identity', [
      fields([['Version', snapshot.production.version], ['Observed', time(snapshot.production.observedAt)]]),
      actions(link('Open public game', snapshot.production.source, 'button')),
    ], { iconName: 'globe' }),
    panel('GitHub release tags', snapshot.releases.length ? list(snapshot.releases.map(item => link(item.name, item.source))) :
      muted(snapshot.health.sources.releases?.state === 'ok' ? 'No GitHub releases listed in the collected window.' : 'GitHub release tags unavailable.'))),
    panel('Recent Pages deployments', rows(snapshot.deployments.map(item => row(
      link(`Deployment ${item.id}`, item.source), [el('code', '', short(item.head)), ' · ', time(item.updatedAt ?? item.createdAt)],
      badge(item.state ?? 'Unknown', item.state === 'success' ? 'green' : item.state === 'failure' ? 'red' : ''))))))];
}

function evidence(id) {
  const developer = snapshot.developers.find(item => item.id === id);
  const selected = developer?.pr ? snapshot.checks.filter(item => item.number === developer.pr) : snapshot.checks;
  const reported = snapshot.reports.filter(item => !developer || item.assignmentId === developer.assignmentId)
    .flatMap(item => [...(item.qualification ?? []), ...(item.reusableEvidence ?? [])]);
  const evidenceRows = [...new Map(reported.map(item => [item.commit + '/' + item.id, item])).values()];
  return [header('Evidence vault', developer ? developer.project : 'GitHub check metadata and reported qualification evidence.',
    developer ? actions(link('All evidence', '#more/evidence', 'button')) : null),
    el('div', 'main-grid', panel('Exact-commit GitHub checks', selected.length ? rows(selected.map(item => row(
      link(item.title, item.source), [`PR #${item.number} · ${short(item.head)} · `, time(item.updatedAt),
        item.mandatory === null ? ' · Requirement unknown' : item.mandatory ? ' · Required' : ' · Optional'],
      badge(item.conclusion ?? item.status ?? 'Unknown', item.conclusion === 'success' ? 'green' : '')))) : muted('No exact-commit checks available.')),
    panel('Developer-reported evidence', evidenceRows.length ? list(evidenceRows.map(item =>
      link(`${item.suite} · ${short(item.commit)} · ${item.outcome}`, item.source))) : muted('Awaiting verified developer reports.')))];
}

function history() {
  const modes = [['1', 'Past day', 1], ['7', 'Past week', 7], ['30', 'Past month', 30], ['all', 'Lifetime', null]];
  const selected = el('select', '', modes.map(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    return option;
  }));
  selected.value = '7';
  const display = el('div', 'stack');
  const pressure = congestion(snapshot);
  const breakdown = { technical: 'Technical and access blockers', creator: 'Creator decisions',
    qualification: 'Mandatory qualification', dependencies: 'Dependencies', inactivity: 'Nonproductive reported sessions',
    contention: 'CI and integration waiting' };
  function refreshHistory() {
    const mode = modes.find(([value]) => value === selected.value);
    const data = summarize(snapshot, mode[2]);
    const previous = mode[2] === null ? null : summarize(snapshot, mode[2],
      Date.parse(snapshot.generatedAt) - mode[2] * 24 * 60 * 60_000 - 1);
    display.replaceChildren(panel('Reporting summary', [
      fields([['Window', mode[1]], ['Assignments reporting', `${data.assignments} / ${snapshot.developers.length}`],
        ['Meaningful sessions in reports', data.reports.length ? String(data.meaningful.length) : 'Unknown'],
        ['Milestones completed in reports', data.reports.length ? String(data.milestones) : 'Unknown'],
        ['Previous window: meaningful sessions', previous?.reports.length ? String(previous.meaningful.length) : 'Unknown']]),
      data.reports.length ? null : muted('No verified reports cover this period.'),
    ], { iconName: 'signal' }), panel('Creator briefing', data.accomplishments.length ?
      rows(data.accomplishments.map(({ text, item }) => row(link(text, item.source), time(item.reportedAt)))) :
      muted('No verified accomplishments are available in this period.'), { iconName: 'book' }));
  }
  selected.addEventListener('change', refreshHistory);
  refreshHistory();
  return [header('Development history', 'Summaries are based on validated session reports.'),
    el('div', 'main-grid', el('div', 'stack', panel('Reporting window', el('label', '', 'Period', selected)), display),
      panel('Congestion evidence', [
        fields([['Score', pressure.score === null ? 'Unknown' : String(pressure.score)],
          ['Evidence coverage', `${pressure.coverage}%`],
          ['Known pressure', pressure.knownPressure === null ? 'Unknown' : String(pressure.knownPressure)]]),
        list(pressure.components.map(component => `${breakdown[component.id]} · ${component.known} / ${pressure.denominator} covered · ${component.weight} possible points`)),
      ], { iconName: 'signal' }))];
}

function directives() {
  return [header('Creator directives', 'Standing rules linked to their public creator sources.'),
    el('div', 'stack', snapshot.directives.map(item => panel(item.name, [muted(item.summary),
      actions(link(`Read issue #${item.number}`, item.source, 'button'))], { end: badge(item.state, 'purple'), iconName: 'book' })))];
}

function moreIndex() {
  return [header('More', 'Source health, release evidence, and planning.'),
    el('div', 'cards', moreRoutes.map(([id, title, desc]) =>
      el('article', 'panel', link(title, '#more/' + id, 'card-link'), muted(desc))))];
}

function render(navigate = false) {
  const [raw, sub, detail] = location.hash.slice(1).split('/');
  const route = routes.some(([id]) => id === raw) ? raw : 'home';
  const path = [route, sub, detail].filter(Boolean).join('/');
  for (const anchor of nav.children) {
    if (anchor.dataset.route === route) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }
  document.querySelector('#current-view').textContent = routes.find(([id]) => id === route)[1];
  let content;
  const moreView = { coverage, activity, releases, evidence, history, directives };
  if (route === 'more' && sub === 'ideas') content = ideasPage(notify);
  else if (route === 'more' && !sub) content = moreIndex();
  else if (!snapshot) content = [header('Development evidence unavailable', 'Load the published snapshot to view developer assignments and progress.'),
    panel('Snapshot status', [muted(loadError ? 'No validated snapshot is available on this device.' : 'Loading the latest published snapshot.'),
      actions(button('Retry snapshot', () => load(true)))])];
  else if (route === 'developers') content = sub ? developerDetail(sub) : developerIndex();
  else if (route === 'roadmap') content = roadmap();
  else if (route === 'inbox') content = inbox();
  else if (route === 'more') content = Object.hasOwn(moreView, sub) ? moreView[sub](detail) : moreIndex();
  else content = home();
  main.replaceChildren(...content);
  if (navigate && activePath !== path) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  activePath = path;
  renderStatus();
}

render();
setupWorker();
load();
