import { approvalQueue, freshState, isSnapshot, latestFor } from './model.mjs';
import { actions, badge, button, el, fields, header, icon, link, list, muted, panel, readLocal, row, rows, saveLocal, short, time } from './ui.mjs';
import { remainingSessions, roadmapProgress } from './estimates.mjs';
import { ideasPage } from './ideas.mjs';
import { congestion, studioTimeline, summarize } from './insights.mjs';
import { accountLabels, accountOf, assignmentStatus, automaticSlots, continuationFor, conversationURL, scopedDevelopers } from './operations.mjs';
import { blockersPanel, workloadPanel } from './dashboard.mjs';
import { creatorNotes, creatorNotesPage } from './creator-notes.mjs';
import { actionGroups, creatorActions } from './command-center.mjs';
import { releaseOverview } from './releases.mjs';
import { masterRoadmap } from './roadmap.mjs';
import { automationOverview, efficiencySignals } from './automation.mjs';

const routes = [
  ['home', 'Home', 'home'], ['developers', 'Developers', 'users'], ['roadmap', 'Roadmap', 'map'],
  ['inbox', 'Command Center', 'inbox'], ['more', 'More', 'more'],
];
const moreRoutes = [
  ['notes', 'Creator Notes', 'Private notes stored in this browser'],
  ['congestion', 'Congestion', 'PR reviews, required gates, dependencies, and checkpoint coverage'],
  ['blockers', 'Blockers', 'Reported impediments and release constraints'],
  ['coverage', 'Reporting coverage', 'Source freshness, synchronization, and onboarding'],
  ['automations', 'Automation oversight', 'Scheduler evidence, recent output, and blockers'],
  ['efficiency', 'Development efficiency', 'Repeated blockers and qualification evidence'],
  ['activity', 'GitHub activity', 'Open PRs, recently closed PRs, workflows, and issues'],
  ['releases', 'Release center', 'Public production identity and GitHub deployment history'],
  ['evidence', 'Evidence vault', 'Exact-commit checks and reported qualification'],
  ['history', 'Development history', 'Reported work, milestones, and creator briefings'],
  ['directives', 'Creator directives', 'Standing rules and protected ownership'],
  ['ideas', 'Idea Vault', 'Local ideas and roadmap proposals'],
];
const categoryName = { manual: 'Manual', automatic: 'Automatic', codex: 'Codex' };
const categoryTone = { manual: 'blue', automatic: 'green', codex: 'purple' };
const sourceNames = { branches: 'Game main reference', pulls: 'Pull requests', issues: 'Issues', workflows: 'Workflows',
  releases: 'GitHub releases', deployments: 'Pages deployments', production: 'Public release identity', publication: 'Public HTML and deployment match',
  releaseRecords: 'Creator release records', changeScope: 'Approved file scope comparisons', schedule: 'HQ scheduled sync runs',
  directives: 'Creator directives', checkpoints: 'Public checkpoints', ownership: 'Creator ownership issues', reviews: 'PR review requests',
  'workflowLoad:queued': 'Queued workflows',
  'workflowLoad:in_progress': 'Running workflows', 'workflowLoad:waiting': 'Waiting workflows', registeredBranches: 'Registered branch HEADs', checks: 'Exact-commit checks', reports: 'Developer reports' };
const skipLink = document.querySelector('.skip-link');
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
const accountOptions = { all: 'All', ...accountLabels };
let accountScope = readLocal('account-scope-v1', 'all');
if (!Object.hasOwn(accountOptions, accountScope)) accountScope = 'all';
let focus = readLocal('focus', false) === true;
let activePath = null;
let toastTimer;
let pendingWorker = null;

for (const [id, name, pictogram] of routes) {
  const item = link([icon(pictogram), el('span', '', name)], '#' + id, 'nav-item');
  item.dataset.route = id;
  nav.append(item);
}
skipLink.addEventListener('click', event => {
  event.preventDefault();
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: 'start' });
});
refresh.append(icon('refresh'));
refresh.addEventListener('click', () => {
  load(true);
  checkUpdates();
});
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

async function savedSnapshot() {
  try {
    const response = await (await caches.open(dataCache)).match(dataURL);
    const data = await response?.json();
    return isSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

function newestSnapshot(first, second) {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first.generatedAt) >= Date.parse(second.generatedAt) ? first : second;
}

async function load(manual = false) {
  if (loading) return;
  loading = true;
  refresh.setAttribute('aria-disabled', 'true');
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
    const best = newestSnapshot(next, newestSnapshot(snapshot, await savedSnapshot()));
    snapshot = best;
    cached = best !== next;
    if (!cached) {
      try {
        const cache = await caches.open(dataCache);
        await cache.put(dataURL, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      } catch { /* The valid in-memory snapshot remains available. */ }
    }
    loadError = false;
    if (manual) notify(cached ? 'Using last validated snapshot' : 'Published snapshot checked');
  } catch {
    snapshot = newestSnapshot(snapshot, await savedSnapshot());
    cached = Boolean(snapshot);
    loadError = true;
    if (manual) notify(cached ? 'Using last validated snapshot' : 'Published snapshot unavailable');
  } finally {
    loading = false;
    refresh.removeAttribute('aria-disabled');
    renderStatus();
    const editingLocal = activePath === 'more/ideas' || activePath === 'more/notes' ||
      Boolean(main.querySelector('form[data-preferences-dirty]'));
    if (!editingLocal && (activePath === null || former?.generatedAt !== snapshot?.generatedAt || loadError !== priorError)) render();
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
const statusBadge = developer => {
  const { label, tone } = assignmentStatus(snapshot, developer);
  return badge(label, tone);
};
const labelFor = category => categoryName[category] ?? category;

function productionPanel() {
  const production = snapshot.production;
  const publication = snapshot.publication;
  return panel('Production', [
    fields([['Public build', production.version ?? 'Unknown'],
      ['Observed', time(production.observedAt)],
      ['Public HTML matched to Pages commit', publication ? link(short(publication.head), publication.source) : 'Unavailable']]),
    actions(link('Release center', '#more/releases', 'button')),
  ], { iconName: 'globe' });
}

function preferences() {
  const data = readLocal('developer-preferences-v1', {});
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function scopedAssignments() {
  const labels = Object.fromEntries(Object.entries(preferences()).map(([id, entry]) => [id, entry?.account]));
  return scopedDevelopers(snapshot.developers, accountScope, labels);
}

function accountFilter() {
  const controls = el('div', 'filters account-filter', el('span', 'muted', 'Developer account'),
    ...Object.entries(accountOptions).map(([value, label]) => {
      const control = button(label, () => {
        accountScope = value;
        saveLocal('account-scope-v1', value);
        render();
        document.querySelector('.account-filter [aria-pressed="true"]')?.focus();
      }, 'filter');
      control.setAttribute('aria-pressed', String(value === accountScope));
      return control;
    }));
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Developer account filter');
  return controls;
}

function continuationButton(developer, report, primary = false) {
  const prompt = continuationFor(developer, report, snapshot);
  const control = button('Continue Development', () => {
    const current = snapshot.developers.find(item => item.id === developer.id);
    const latest = current && reportFor(current);
    const latestPrompt = current && continuationFor(current, latest, snapshot);
    if (!latestPrompt) {
      notify('A current continuation checkpoint is unavailable.');
      return;
    }
    copy(latestPrompt, `Checkpoint ${short(current.head)} copied`);
  }, primary ? 'primary' : '');
  control.disabled = !prompt;
  return control;
}

function openConversation(developer) {
  const href = conversationURL(preferences()[developer.id]?.conversation);
  return href ? Object.assign(el('a', 'button', 'Open conversation'), { href, rel: 'noopener noreferrer', target: '_blank' }) : null;
}

function developerPreferences(developer) {
  const current = preferences()[developer.id];
  const account = el('select', '', ...Object.entries(accountLabels).map(([value, label]) =>
    Object.assign(el('option', '', label), { value })));
  account.value = accountOf(developer, { [developer.id]: current?.account });
  account.disabled = Boolean(developer.ownership);
  const chat = Object.assign(el('input'), { type: 'url', maxLength: 240,
    placeholder: 'https://chatgpt.com/c/…', value: conversationURL(current?.conversation) ?? '' });
  const form = el('form', '', el('label', '', 'Developer account', account),
    developer.category === 'manual' ? el('label', '', 'ChatGPT conversation', chat) : null,
    actions(button('Save preferences', null, 'primary', 'submit')));
  form.addEventListener('input', () => { form.dataset.preferencesDirty = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const conversation = chat.value.trim() ? conversationURL(chat.value.trim()) : null;
    if (chat.value.trim() && !conversation) {
      notify('Enter a ChatGPT conversation URL without a query or fragment.');
      return;
    }
    if (!saveLocal('developer-preferences-v1', { ...preferences(), [developer.id]: { account: account.value, conversation } })) {
      notify('Could not save browser preferences.');
      return;
    }
    render();
    notify('Saved on this device');
  });
  return panel('Developer preferences', [muted('Account labels and conversation links are saved in this browser.'), form], { iconName: 'users' });
}

const teamNames = { manual: 'Manual Developers', codex: 'Codex Developers', automatic: 'Automatic Developers' };

function teamPanel(category, developers) {
  const group = developers.filter(item => item.category === category);
  const verifiedSchedules = group.filter(item => item.scheduleObservedAt);
  const shown = (category === 'automatic' ? [...verifiedSchedules, ...group.filter(item => !item.scheduleObservedAt)] : group)
    .slice(0, category === 'automatic' ? 3 : 2);
  const count = category === 'automatic' && accountScope === 'all'
    ? badge(`${group.length} / ${Math.max(group.length, automaticSlots)} roster entries`, 'green')
    : badge(String(group.length), categoryTone[category]);
  return panel(teamNames[category], [
    category === 'automatic' && accountScope === 'all'
      ? muted(`${verifiedSchedules.filter(item => item.scheduleEnabled).length} enabled when checked · ${verifiedSchedules.filter(item => !item.scheduleEnabled).length} paused when checked · ${group.length - verifiedSchedules.length} unverified`) : null,
    shown.length ? rows(shown.map(developer => {
      const report = reportFor(developer);
      return row(developerLink(developer, developer.name), [
        developer.project, el('div', 'team-status', statusBadge(developer)),
        category === 'manual' ? actions(continuationButton(developer, report), openConversation(developer)) : null,
        category === 'manual' && !continuationFor(developer, report, snapshot) ? muted('Awaiting a verified checkpoint.') : null,
        category === 'automatic' && developer.scheduleObservedAt
          ? scheduleBadge(developer) : null,
        category === 'codex' && report?.milestone ? el('span', '', `Milestone · ${report.milestone}`) : null,
      ]);
    })) : muted('No assignments match this account filter.'),
    actions(link(`View all ${category} developers`, `#developers/${category}`, 'button'),
      category === 'automatic' ? link('Automation oversight', '#more/automations', 'button') : null),
  ], { iconName: category === 'automatic' ? 'bolt' : 'users', end: count, tone: 'team-card ' + category });
}

function home() {
  const developers = scopedAssignments();
  const assignments = new Set(developers.map(item => item.assignmentId));
  const queue = creatorActions(snapshot, developers);
  const verified = developers.filter(reportFor).length;
  const reports = snapshot.reports.filter(item => item.outcome === 'development' && assignments.has(item.assignmentId)).slice(-4).reverse();
  const focusButton = button(focus ? 'Exit Focus Mode' : 'Focus Mode', () => {
    focus = !focus;
    saveLocal('focus', focus);
    render();
    document.querySelector('#focus-mode')?.focus({ preventScroll: true });
  });
  focusButton.id = 'focus-mode';
  focusButton.prepend(icon('focus'));
  const logo = el('img');
  Object.assign(logo, { src: './assets/icon-512.png', alt: '' });
  const hero = el('section', 'hero',
    el('div', 'hero-copy', el('h1', '', focus ? 'Creator focus' : 'Development overview'),
      el('p', '', 'See developer assignments, active workflows, and release evidence for Mythwrought.'),
      actions(focusButton)), el('div', 'hero-emblem', logo));
  const stale = cached || freshState(snapshot) === 'Stale snapshot';
  const nextAction = panel('Creator Command Center', [
    stale ? muted('Showing last published evidence. Review current GitHub state before acting.') : null,
    queue.length ? rows(queue.slice(0, focus ? 5 : 3).map(commandRow)) : noCreatorActions(),
    actions(link('Open Command Center', '#inbox', 'button gold')),
  ], {
    iconName: 'inbox', tone: 'gold-panel creator-action',
    end: queue.length ? badge(String(queue.length), 'gold') : null,
  });
  const outcomes = panel('Recent Developer Work', reports.length ? rows(reports.map(report => row(
    link(report.completed?.[0] ?? 'Development session', report.source), time(report.reportedAt), badge('Verified report', 'green'))))
    : muted('Waiting for a verified development session report.'), { iconName: 'bolt' });
  const notes = creatorNotes().filter(note => !note.archived).length;
  return [hero, accountFilter(), el('div', 'operations-home',
    nextAction,
    focus ? null : el('div', 'team-grid', ['manual', 'codex', 'automatic'].map(category => teamPanel(category, developers))),
    el('div', 'dashboard-grid', workloadPanel(snapshot, developers), blockersPanel(snapshot, developers)),
    focus ? outcomes : el('div', 'dashboard-grid',
      panel('Creator Notes', [
        muted(`${notes} ${notes === 1 ? 'note' : 'notes'} saved in this browser.`),
        actions(link('Open Creator Notes', '#more/notes', 'button')),
      ], { iconName: 'book' }),
      panel('Reporting Health', [
        fields([['Verified reports', `${verified} / ${developers.length} assignments`],
          ['Last usable collection', time(snapshot.health.lastSuccess)],
          ['Snapshot status', freshState(snapshot)]]),
        actions(link('View source health', '#more/coverage', 'button')),
      ], { iconName: 'refresh' })),
    focus ? null : el('div', 'dashboard-grid', outcomes, productionPanel()))];
}

function scheduleBadge(developer) {
  return badge(developer.scheduleEnabled ? 'Schedule enabled when checked' : 'Schedule paused when checked',
    developer.scheduleEnabled ? 'green' : 'gold');
}

function developerIndex(category = 'all') {
  const filterBar = el('div', 'filters', ...Object.entries({ all: 'All developers', ...categoryName }).map(([value, name]) => {
    const control = link(name, value === 'all' ? '#developers' : `#developers/${value}`, 'button filter');
    if (value === category) control.setAttribute('aria-current', 'page');
    return control;
  }));
  const available = scopedAssignments();
  const matches = available.filter(item => category === 'all' || category === item.category);
  const gaps = category === 'automatic' && accountScope === 'all'
    ? Math.max(0, automaticSlots - matches.length) : 0;
  const tiles = matches.map(developer => {
    const report = reportFor(developer);
    return el('article', 'panel', badge(labelFor(developer.category), categoryTone[developer.category]),
      developerLink(developer, developer.name, 'card-link'), el('p', '', developer.project),
      muted(report ? `Latest outcome · ${report.outcome}` : developer.authority), el('div', '', statusBadge(developer)),
      developer.category === 'automatic' && developer.scheduleObservedAt
        ? [muted(`Hourly at :${String(developer.minute).padStart(2, '0')} · ${developer.timezone}`), el('div', '', scheduleBadge(developer))] : null,
      developer.category === 'manual' ? actions(continuationButton(developer, report), openConversation(developer)) : null,
      developer.category === 'manual' && !continuationFor(developer, report, snapshot) ? muted('Awaiting a verified checkpoint.') : null);
  });
  return [header(teamNames[category] ?? 'Developers', category === 'automatic' && accountScope === 'all'
    ? `${matches.length} roster entries. ${matches.filter(item => item.scheduleObservedAt).length} schedules verified from the connected automation account.`
    : 'Browse assignments by workspace. Creator records take precedence over local labels.'), accountFilter(), filterBar,
    tiles.length || gaps ? el('div', 'cards', tiles, Array.from({ length: gaps }, (_, index) =>
      el('article', 'panel empty-slot', el('h2', '', `Roster slot ${matches.length + index + 1}`), muted('Developer and schedule unverified.'))))
      : muted('No assignments match this account filter.')];
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
  const status = assignmentStatus(snapshot, developer);
  const completedSessions = new Set(reports.filter(item => ['development', 'qualification', 'administration'].includes(item.outcome))
    .map(item => item.sessionId)).size;
  const accomplishment = reports.find(item => item.outcome === 'development' && item.completed?.length);
  const continuationControl = continuationButton(developer, report, true);
  const continuation = continuationFor(developer, report, snapshot);
  const outcome = report ? `${report.outcome} · ${report.releaseReadiness ?? 'Release readiness unknown'}` : 'No verified report';
  const progress = panel('Progress and next work', [
    fields([['Latest authenticated report', report ? link(time(report.reportedAt), report.source) : 'Unavailable'], ['Reported outcome', outcome],
      ['Status evidence', status.source ? link(status.basis, status.source) : status.basis],
      ['Reported phase', report?.releaseReadiness], ['Current milestone', report?.milestone],
      ['Latest meaningful accomplishment', accomplishment ? link(accomplishment.completed[0], accomplishment.source) : 'Unavailable'],
      ['Completed sessions recorded', reports.length ? String(completedSessions) : 'Unavailable'],
      ['Reported next objective', exact ? report?.nextObjective : 'Unavailable at the current commit'],
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
  const recorded = developer.lastSchedulerResult;
  const expected = automationOverview(snapshot, [developer])[0]?.next;
  const schedule = developer.category === 'automatic' ? panel('Automation reporting', [
    fields([['Hourly slot', developer.minute === null ? 'Unknown' : `:${String(developer.minute).padStart(2, '0')}${developer.scheduleObservedAt ? '' : ' · creator brief'}`],
      ['Schedule timezone', developer.timezone],
      ['Configuration when checked', developer.scheduleEnabled == null ? 'Unknown' : developer.scheduleEnabled ? 'Enabled' : 'Paused'],
      ['Schedule verified', developer.scheduleObservedAt ? time(developer.scheduleObservedAt) : 'Unknown'],
      ['Next scheduled occurrence', expected ? time(expected) : 'Unavailable'],
      ['Last recorded run completion', time(recorded?.completedAt)],
      ['Scheduler result checked', time(recorded?.observedAt)],
      ['Creator action on last result', recorded ? (recorded.needsCreatorAction ? 'Requested' : 'None reported') : 'Unknown'],
      ['Public output linked to last result', recorded?.publicOutput ? link('Open commit', recorded.publicOutput) : 'Unknown'],
      ['Last verified developer report', report && time(report.reportedAt)],
      ['Reported run state', report?.execution ? `${report.execution.state} · observed` : 'Unknown']]),
    expected ? muted('The next occurrence is calculated from the last verified schedule.') : null,
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
        ['Workspace / ownership', developer.ownership ? link(
          `${accountLabels[developer.ownership.workspace]} · ${developer.ownership.owner ?? 'Confirmed unassigned'}`,
          developer.ownership.source) : 'Unavailable from creator records'],
        ['Repository', developer.repository], ['Branch', developer.branch], ['Verified HEAD', developer.head ? el('code', '', developer.head) : 'Unknown'],
        ['Branch evidence', developer.headStatus], ['Branch last observed', time(developer.branchObservedAt)],
        ...(!developer.head && developer.branchHead ? [['Last observed branch commit', el('code', '', developer.branchHead)]] : []),
        ['Checkpoint feed', developer.reportFeedState ?? 'No registered feed'],
        ['Pull request', candidate ? link(`#${candidate.number} · ${candidate.draft ? 'Draft' : candidate.state}`, candidate.source)
          : report?.pull ? link(`#${report.pull}`, `https://github.com/${report.repository}/pull/${report.pull}`) : 'Unknown'],
        ['Public checkpoint', developer.publicCheckpoint ? publicCheckpointLink(developer) : 'Unavailable'],
        ['Report checkpoint', report ? link(short(report.commit), report.checkpoint ?? report.source) : 'Unknown']]),
      report && !exact ? muted('Checkpoint is stale or the current HEAD is unverified.') : null,
      actions(continuationControl, openConversation(developer), developer.pr ? link('View exact-commit checks', '#more/evidence/' + developer.id, 'button') : null),
      continuation ? el('details', '', el('summary', '', 'View continuation prompt'), el('p', 'wrap-text', continuation)) : null,
    ], { iconName: 'branch' }), developerPreferences(developer), schedule))];
}

function roadmap() {
  const overview = masterRoadmap(snapshot, scopedAssignments());
  const releases = new Map(releaseOverview(snapshot).candidates.map(item => [item.developer.assignmentId, item]));
  const label = id => snapshot.developers.find(item => item.assignmentId === id)?.project ?? id;
  const proposals = readLocal('ideas-v1', []);
  const localProposals = Array.isArray(proposals) ? proposals.filter(item => item?.proposal && !item.archived) : [];
  const critical = overview.criticalPath;
  const phase = (title, milestones) => milestones.length ? el('section', '', el('h3', '', title),
    list(milestones.map(item => `${item.label} · ${item.complete ? 'Complete' : 'Remaining'}`))) : null;
  return [header('Roadmap', 'Development milestones, remaining work, and release dependencies.'), accountFilter(),
    panel('Milestone coverage', fields([['Programs in view', String(overview.programs.length)],
      ['Programs with milestones', String(overview.planCount)],
      ['Milestones in reported plans', overview.milestoneCount ? `${overview.completed} / ${overview.milestoneCount} complete` : 'Unavailable']]),
    { iconName: 'map' }),
    el('div', 'main-grid', panel('Development programs', overview.programs.length ? overview.programs.map(({ developer, report, plan, estimate }) => {
      const release = releases.get(developer.assignmentId);
      const milestones = plan?.milestones ?? [];
      return el('details', 'activity-group',
        el('summary', '', `${developer.project} · ${milestones.length ?
          `${milestones.filter(item => item.complete).length} / ${milestones.length} complete` : 'Milestones unavailable'}`),
        fields([['Developer', developerLink(developer, developer.name)], ['Status', statusBadge(developer)],
          ['Reported milestone', report?.milestone], ['Roadmap revision', plan?.revision],
          ['Remaining sessions', estimate ? `${estimate.optimistic}–${estimate.conservative} estimated · ${estimate.confidence} confidence` : 'Unavailable'],
          ['Release state', release ? link(release.stage, '#more/releases') : report?.releaseReadiness],
          ['Checkpoint', developer.publicCheckpoint ? publicCheckpointLink(developer) : report ? link('Open authenticated report', report.source) : 'Unavailable']]),
        phase('Development milestones', milestones.filter(item => item.kind === 'development')),
        phase('Qualification milestones', milestones.filter(item => item.kind === 'qualification')));
    }) : muted('No registered programs in this scope.'), { iconName: 'map' }),
    el('div', 'stack',
      panel('Critical path', [
        critical ? [muted(`${critical.sessions} estimated work sessions along the longest registered chain.`),
          el('ol', 'items', critical.programs.map(({ developer }) => el('li', '', developerLink(developer))))] :
          muted('Critical-path duration is unavailable with the current dependency and estimate coverage.'),
        overview.cycles.length ? list(overview.cycles.map(cycle => 'Circular dependency · ' + cycle)) : null,
        overview.bottlenecks.length ? list(overview.bottlenecks.map(entry =>
          link(`${label(entry.assignmentId)} · ${entry.edges.length} open prerequisite ${entry.edges.length === 1 ? 'link' : 'links'}`, entry.edges[0].source))) : null,
      ], { iconName: 'signal' }),
      panel('Release dependencies', list(overview.edges.map(edge =>
        link(`${label(edge.assignment)} depends on ${label(edge.prerequisite)} · ${edge.state}`, edge.source)), 'No registered dependencies'),
      { iconName: 'branch' }),
      panel('Local proposals', list(localProposals.map(item => String(item.title)), 'No local proposals'), { end: link('Idea Vault', '#more/ideas') })))];
}

function noCreatorActions() {
  return muted('No actions found in the available evidence. Unreported assignments may still need attention.');
}

function commandRow(item, detailed = false) {
  const { name, tone } = actionGroups[item.kind];
  const [first, ...additional] = item.sources;
  const decision = item.decision;
  const authorizationText = detailed && decision ? button('Copy authorization text', () => copy(
    `I authorize ${decision.action}${decision.commit ? ` at exact commit ${decision.commit}` : ''} for ${decision.developer.project}. Scope: ${decision.reason}`,
    'Authorization text copied'), 'gold') : null;
  if (authorizationText) authorizationText.disabled = item.approvalHeld || !navigator.onLine || cached || freshState(snapshot) === 'Stale snapshot' ||
    decision.developer.reportFeedState === 'partial' || Boolean(decision.commit && decision.developer.head !== decision.commit);
  return row(link(item.title, first), [
    item.developers.map(developer => developerLink(developer, developer.name)).flatMap((node, index) => index ? [' · ', node] : [node]),
    el('div', '', item.detail), detailed ? el('div', '', item.provenance) : null,
    detailed ? additional.map((source, index) => el('div', '', link(`Supporting evidence ${index + 1}`, source))) : null,
    detailed && decision ? fields([['Exact commit', decision.commit ? el('code', '', decision.commit) : 'Unavailable'],
      ['Requested', time(decision.requestedAt)], ['Limitations', decision.limitations],
      ['Affected dependencies', decision.affected?.join(', ') || 'Unavailable']]) : null,
    authorizationText ? actions(authorizationText) : null,
    detailed && item.approvalHeld ? muted('Resolve the linked ownership or qualification hold before authorizing.') : null,
  ], badge(name, tone));
}

function inbox() {
  const scoped = scopedAssignments();
  const queue = creatorActions(snapshot, scoped);
  const stale = cached || freshState(snapshot) === 'Stale snapshot';
  const selected = new Set(scoped.map(item => item.assignmentId));
  const obsolete = approvalQueue(snapshot).filter(item => selected.has(item.developer.assignmentId) &&
    ['HEAD changed', 'HEAD unverified'].includes(item.state));
  return [header('Creator Command Center', 'Prioritized actions linked to their GitHub evidence.'), accountFilter(),
    stale ? panel('Snapshot needs a refresh', muted('Showing last published evidence. Review current GitHub state before acting.'),
      { iconName: 'warning' }) : null,
    el('div', 'stack', queue.length ? Object.entries(actionGroups).flatMap(([kind, group]) => {
      const matching = queue.filter(item => item.kind === kind);
      return matching.length ? [panel(group.name, rows(matching.map(item => commandRow(item, true))), { iconName: 'inbox' })] : [];
    }) : panel('Actions', noCreatorActions(), { iconName: 'inbox' }),
    obsolete.length ? el('details', 'panel', el('summary', '', 'Requests with changed or unverified commits'),
      rows(obsolete.map(item => row(link(item.action, item.report.source), item.developer.project, badge(item.state, 'gold'))))) : null,
    panel('Coverage', fields([['Assignments with a developer report', `${scoped.filter(reportFor).length} / ${scoped.length}`],
      ['Assignments with a creator ownership record', `${scoped.filter(item => item.ownership).length} / ${scoped.length}`],
      ['Last successful collection', time(snapshot.health.lastSuccess)]]),
    { end: link('Reporting coverage', '#more/coverage') }))].filter(Boolean);
}

function coverage() {
  const statusBadges = { ok: 'green', partial: 'gold', error: 'red' };
  const healthData = snapshot.health;
  const scheduled = snapshot.schedule?.latest;
  const completed = snapshot.schedule?.lastCompleted;
  return [header('Reporting coverage', 'Public GitHub metadata and developer-submitted reports have separate coverage.'),
    el('div', 'main-grid', el('div', 'stack', panel('Synchronization', fields([
      ['Last collection attempt', time(healthData.lastAttempt)], ['Last usable core collection', time(healthData.lastSuccess)],
      ['Snapshot generated', time(snapshot.generatedAt)], ['Target schedule from last collection', time(healthData.nextExpected)],
      ['Last scheduled run', scheduled ? link([time(scheduled.createdAt), ` · ${scheduled.conclusion ?? scheduled.status ?? 'Unknown'}`], scheduled.source)
        : healthData.sources.schedule?.state === 'ok' ? 'None recorded by GitHub' : 'Unavailable'],
      ['Last completed scheduled run', completed ? link([time(completed.createdAt), ` · ${completed.conclusion ?? 'Unknown'}`], completed.source) : 'Unavailable'],
      ['GitHub quota remaining', healthData.rateLimit?.remaining === null ? 'Unknown' : String(healthData.rateLimit?.remaining ?? 'Unknown')],
      ['Game main', snapshot.mainHead ? el('code', '', snapshot.mainHead) : 'Unknown'],
    ]), { iconName: 'refresh' }),
    panel('Source health', rows(Object.entries(healthData.sources).map(([key, item]) => row(
      el('strong', '', sourceNames[key] ?? key), [time(item.lastSuccess), item.note && ' · ' + item.note],
      badge(item.state, statusBadges[item.state])))))),
    panel('Developer coverage', rows(snapshot.developers.map(developer => {
      const confirmed = reportFor(developer);
      const state = confirmed ? 'Connected and verified' : developer.publicCheckpoint?.preserved ? 'Last verified checkpoint' :
        developer.publicCheckpoint ? 'Public checkpoint linked' : developer.registeredSources.length ? 'Awaiting verified report'
        : developer.status === 'Deferred per brief' ? 'Intentionally deferred' : 'Source unconfirmed';
      return row(developerLink(developer, developer.name),
        confirmed ? link('Open verified report', confirmed.source) : developer.publicCheckpoint ? publicCheckpointLink(developer) : developer.authority,
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
  const { publication, physical, liveStage, livePull, candidates } = releaseOverview(snapshot);
  const stale = cached || freshState(snapshot) === 'Stale snapshot';
  return [header('Release center', 'Candidate, deployment, and device evidence for Mythwrought.'),
    panel('Production at last observation', [
      stale ? muted('Showing the last published snapshot. See GitHub and the public game for current state.') : null,
      fields([['Public version', snapshot.production.version ?? 'Unavailable'], ['Observed', time(snapshot.production.observedAt)],
        ['Public HTML matched to Pages commit', publication ? link(publication.head, publication.commitSource) : 'Unavailable'],
        ['Pages deployment', publication ? link(`Deployment ${publication.deploymentId}`, publication.source) : 'Unavailable'],
        ['Merged PR for public commit', livePull ? link(`#${livePull.number} · ${livePull.title}`, livePull.source) : 'Unavailable'],
        ['Physical iPhone evidence', physical ? link([`${physical.device} · ${physical.result} · `, time(physical.recordedAt)], physical.evidence)
          : 'No exact-build record available']]),
      actions(link('Open public game', snapshot.production.source, 'button')),
    ], { iconName: 'globe', end: badge(liveStage, physical?.result === 'passed' ? 'green' : 'gold') }),
    panel('Registered release candidates', candidates.length ? candidates.map(({ developer, pull, stage, report, gate, approval, request, published }) =>
      el('details', 'activity-group', el('summary', '', `${developer.project} · ${stage}`),
        fields([['Candidate', link(pull.head, pull.source)], ['Candidate base', el('code', '', pull.base)],
          ['Merge commit', pull.mergeCommit ? link(pull.mergeCommit, pull.source) : 'Unavailable'],
          ['Required checks for candidate', gate ? link(gate.state, gate.source) : 'Unavailable'],
          ['Creator authorization', approval ? link(approval.detail, approval.source) :
            request ? link(request.action, request.report.source) : 'Unavailable'],
          ['Recorded successful deployment', published ? link(`Deployment ${published.id}`, published.lastSuccessSource ?? published.source) : 'Unavailable'],
          ['Developer checkpoint', developer.publicCheckpoint ? publicCheckpointLink(developer) :
            report ? link('Open authenticated report', report.source) : 'Unavailable']]),
        actions(link('Exact-commit evidence', '#more/evidence/' + developer.id, 'button')))) : muted('No registered release candidates in this snapshot.'),
    { iconName: 'branch' }),
    el('div', 'dashboard-grid',
      panel('GitHub release tags', list(snapshot.releases.map(item => link(item.name, item.source)), 'No release tags in the available window.')),
      panel('Recent Pages deployments', snapshot.deployments.length ? rows(snapshot.deployments.map(item => row(
        link(`Deployment ${item.id}`, item.source), [el('code', '', short(item.head)), ' · ', time(item.updatedAt ?? item.createdAt)],
        badge(item.state ?? 'Unknown', item.state === 'success' ? 'green' : item.state === 'failure' ? 'red' : '')))) : muted('Deployment evidence is unavailable.')))];
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
      link(item.title, item.source), [`PR #${item.number} · ${short(item.head)} · ${item.kind === 'status' ? 'Commit status' : 'Check run'} · `, time(item.updatedAt),
        item.preserved ? ' · Preserved result, current requirement unavailable' :
          item.mandatory === null ? ' · Requirement unknown' : item.mandatory ? ' · Required' : ' · Optional'],
      badge(item.conclusion ?? item.status ?? 'Unknown', item.conclusion === 'success' ? 'green' : '')))) : muted('No exact-commit checks available.')),
    panel('Developer-reported evidence', evidenceRows.length ? list(evidenceRows.map(item =>
      link(`${item.suite} · ${short(item.commit)} · ${item.outcome}`, item.source))) : muted('Awaiting verified developer reports.')))];
}

function publicCheckpointLink(developer) {
  const checkpoint = developer.publicCheckpoint;
  const state = checkpoint.preserved ? 'Last verified' : checkpoint.commit === developer.head ? 'Matches HEAD' : 'Predates HEAD';
  const kind = checkpoint.kind === 'file' ? 'File revision' : 'Owner comment';
  return link([`${kind} · ${short(checkpoint.commit)} · ${state} · `, time(checkpoint.recordedAt)], checkpoint.source);
}

function congestionPage() {
  const developers = scopedAssignments();
  const pressure = congestion(snapshot, developers);
  const stale = cached || freshState(snapshot) === 'Stale snapshot';
  const score = pressure.score !== null ? `${pressure.score} / 100` :
    pressure.lower !== null ? `${pressure.lower}–${pressure.upper} / 100 possible` : 'Unavailable';
  const draftCount = pressure.candidates.filter(item => item.pull.draft).length;
  return [header('Congestion', 'Review queues, required gates, and verified evidence for the selected workspace.'), accountFilter(),
    panel('Development pressure', [
      fields([['Pressure at snapshot time', score], ['Evidence coverage', `${pressure.coverage}%`],
        ['Assignments assessed', String(pressure.denominator)], ['Open tracked PRs', String(pressure.candidates.length)],
        ['Tracked drafts', String(draftCount)], ['Snapshot', time(snapshot.generatedAt)]]),
      stale ? muted('Showing the last published observation. Check GitHub for current queue activity.') : null,
      el('details', '', el('summary', '', 'How the score works'),
        muted('Each signal contributes its weight times the share of assessed assignments affected. The range allows for every unknown observation. Full coverage produces a single score. Intentionally deferred or accepted work is excluded from the score.')),
    ], { iconName: 'signal' }),
    el('div', 'dashboard-grid',
      panel('Pressure by source', pressure.components.map(component => el('details', 'activity-group',
        el('summary', '', `${component.label} · ${component.entries.length} observed · ${component.known} / ${pressure.denominator} covered`),
        muted(`${component.weight} possible points. ${component.next}`),
        component.entries.length ? rows(component.entries.map(item =>
          row(developerLink(item.developer), link(item.detail, item.source)))) : muted('No affected assignment in the available evidence.')))),
      panel('Tracked pull requests', pressure.candidates.length ? rows(pressure.candidates.map(({ developer, pull }) =>
        row(link(`#${pull.number} · ${developer.project}`, pull.source),
          pull.draft ? 'Draft' : developer.review?.requested == null ? 'Review requests unavailable' :
            `${developer.review.requested} open review requests`,
          badge(developer.requiredGate?.state ?? 'Required gates unavailable')))) :
        muted('No open registered PRs in this scope have a verified HEAD.'))),
    panel('Published release constraints', pressure.constraints.length ? rows(pressure.constraints.map(edge => {
      const owner = snapshot.developers.find(item => item.assignmentId === edge.assignment);
      const prerequisite = snapshot.developers.find(item => item.assignmentId === edge.prerequisite);
      return row(link(`${owner?.project ?? edge.assignment} awaits ${prerequisite?.project ?? edge.prerequisite}`, edge.source), edge.scope);
    })) : muted('No registered release constraints in this scope.'), { iconName: 'warning' }),
    workloadPanel(snapshot, developers, { expanded: true })];
}

function history() {
  const scope = scopedAssignments();
  const ids = new Set(scope.map(item => item.assignmentId));
  const scopedSnapshot = { ...snapshot, reports: snapshot.reports.filter(item => ids.has(item.assignmentId)) };
  const modes = [['1', 'Past day', 1], ['7', 'Past week', 7], ['30', 'Past month', 30], ['all', 'Lifetime', null]];
  const selected = el('select', '', modes.map(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    return option;
  }));
  selected.value = '7';
  const display = el('div', 'stack');
  function refreshHistory() {
    const mode = modes.find(([value]) => value === selected.value);
    const data = summarize(scopedSnapshot, mode[2]);
    const previous = mode[2] === null ? null : summarize(scopedSnapshot, mode[2],
      Date.parse(snapshot.generatedAt) - mode[2] * 24 * 60 * 60_000 - 1);
    const timeline = studioTimeline(snapshot, scope, mode[2], accountScope === 'all');
    display.replaceChildren(panel('Reporting summary', [
      fields([['Window', mode[1]], ['Assignments reporting', `${data.assignments} / ${scope.length}`],
        ['Meaningful sessions in reports', data.reports.length ? String(data.meaningful.length) : 'Unknown'],
        ['Milestones completed in reports', data.reports.length ? String(data.milestones) : 'Unknown'],
        ['Previous window: meaningful sessions', previous?.reports.length ? String(previous.meaningful.length) : 'Unknown']]),
      data.reports.length ? null : muted('No verified reports cover this period.'),
    ], { iconName: 'signal' }), panel('Creator briefing', data.accomplishments.length ?
      rows(data.accomplishments.map(({ text, item }) => row(link(text, item.source), time(item.reportedAt)))) :
      muted('No verified accomplishments are available in this period.'), { iconName: 'book' }),
    panel('Studio timeline', timeline.length ? [
      rows(timeline.slice(0, 60).map(item => row(link(item.title, item.source), [time(item.at), item.detail && ` · ${item.detail}`], badge(item.type)))),
      timeline.length > 60 ? muted(`Showing the 60 most recent of ${timeline.length} observed events.`) : null,
    ] : muted('No sourced events in this window.'), { iconName: 'bolt' }));
  }
  selected.addEventListener('change', refreshHistory);
  refreshHistory();
  return [header('Development history', 'Reported accomplishments and verified GitHub events.'), accountFilter(),
    el('div', 'main-grid', el('div', 'stack', panel('Reporting window', el('label', '', 'Period', selected)), display),
      panel('Congestion evidence', actions(link('Open Congestion', '#more/congestion', 'button')), { iconName: 'signal' }))];
}

function automations() {
  const oversight = automationOverview(snapshot, scopedAssignments());
  return [header('Automation oversight', 'Schedules, authenticated sessions, and published repository checkpoints.'), accountFilter(),
    panel('Automatic assignments', [
      fields([['Roster entries in view', String(oversight.length)],
        ['Schedules observed in the last 24 hours', String(oversight.filter(item => item.scheduleCurrent).length)],
        ['Assignments with an authenticated report', String(oversight.filter(item => item.latest).length)]]),
      oversight.length ? oversight.map(({ developer, latest, currentReport, accomplishments, failures, next, production }) => {
        const recorded = developer.lastSchedulerResult;
        const configuration = developer.scheduleEnabled == null ? 'Unavailable' : developer.scheduleEnabled ? 'Enabled when checked' : 'Paused when checked';
        const slot = Number.isInteger(developer.minute) ? `Hourly at :${String(developer.minute).padStart(2, '0')}` : null;
        return el('details', 'activity-group', el('summary', '', `${developer.name} · ${developer.project}`),
          fields([['Profile', developerLink(developer, developer.name)], ['Schedule', slot ?
            `${slot}${developer.scheduleObservedAt ? ` · ${developer.timezone}` : ' · creator brief'}` : 'Unavailable'],
            ['Scheduler configuration', configuration], ['Configuration observed', time(developer.scheduleObservedAt)],
            ['Next expected from last observation', next ? time(next) : 'Unavailable'],
            ['Last scheduler completion observed', time(recorded?.completedAt)],
            ['Last reported execution', latest?.execution ? link(time(latest.execution.observedAt), latest.execution.evidence) : 'Unavailable'],
            ['Last report outcome', latest ? link(latest.outcome, latest.source) : 'Unavailable'],
            ['Consecutive failed or blocked reports', failures == null ? 'Unavailable' : String(failures)],
            ['Latest meaningful accomplishment', accomplishments ? link(accomplishments.completed[0], accomplishments.source) : 'Unavailable'],
            ['Repository checkpoint', developer.publicCheckpoint ? publicCheckpointLink(developer) : 'Unavailable'],
            ['Output linked by scheduler', recorded?.publicOutput ? link('Open commit', recorded.publicOutput) : 'Unavailable'],
            ['Verified production output', production ? link(short(production.head), production.source) : 'Unavailable']]),
          el('h3', '', 'Current reported blockers'), list(currentReport?.blockers?.map(item => link(item.description, item.evidence)),
            currentReport?.blockers ? 'None reported at this commit.' : 'Unavailable at this commit.'));
      }) : muted('No automation assignments in this scope.'),
      actions(link('View development efficiency', '#more/efficiency', 'button')),
    ], { iconName: 'bolt' })];
}

function efficiency() {
  const developers = scopedAssignments();
  const items = efficiencySignals(snapshot, developers);
  const overlaps = creatorActions(snapshot, developers).filter(item => item.kind === 'ownership');
  const rules = snapshot.directives.filter(item => [501, 509].includes(item.number));
  const comparisons = developers.filter(item => item.head && item.changeScope?.head === item.head);
  return [header('Development efficiency', 'Patterns in authenticated session evidence for creator review.'), accountFilter(),
    panel('Session and qualification patterns', [
      muted('Matching reports prompt a review of test purpose, inputs, and applicable gates.'),
      items.length ? rows(items.map(item => row(developerLink(item.developer), [
        el('strong', '', item.label), el('div', '', item.detail), list(item.sources.map((source, index) => link(`Evidence ${index + 1}`, source))),
      ]))) : muted('No repeated patterns in the available structured reports.'),
    ], { iconName: 'signal' }),
    panel('Ownership and creator directives', [
      overlaps.length ? rows(overlaps.map(item => commandRow(item, true))) : null,
      list(rules.map(item => link(`#${item.number} · ${item.name}`, item.source)), 'Directives unavailable'),
    ], { iconName: 'book' }),
    panel('Recorded change boundaries', comparisons.length ? comparisons.map(developer => {
      const result = developer.changeScope;
      return el('details', 'activity-group', el('summary', '',
        `${developer.project} · ${result.complete ? '' : 'At least '}${result.count} paths outside recorded scope`),
        fields([['Base and candidate', link(`${short(result.base)} → ${short(result.head)}`, result.source)],
          ['Creator ownership source', developer.ownership ? link('Read recorded boundaries', developer.ownership.source) : 'Unavailable'],
          ['Workflow or build paths outside scope', String(result.infrastructure)]]),
        result.outside.length ? list(result.outside) : null);
    }) : muted('Exact change comparisons are available for assignments with reviewed file boundaries.'), { iconName: 'branch' })];
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
  const moreView = { coverage, activity, releases, evidence, history, directives, automations, efficiency, congestion: congestionPage,
    blockers: () => [header('Blockers', 'Reported blockers and verified release constraints.'), accountFilter(),
      blockersPanel(snapshot, scopedAssignments(), true)] };
  if (route === 'more' && sub === 'ideas') content = ideasPage(notify);
  else if (route === 'more' && sub === 'notes') content = creatorNotesPage({ notify, copy });
  else if (route === 'more' && !sub) content = moreIndex();
  else if (!snapshot) content = [header('Development evidence unavailable', 'Load the published snapshot to view developer assignments and progress.'),
    panel('Snapshot status', [muted(loadError ? 'No validated snapshot is available on this device.' : 'Loading the latest published snapshot.'),
      actions(button('Retry snapshot', () => load(true)))])];
  else if (route === 'developers') content = !sub || Object.hasOwn(categoryName, sub) ? developerIndex(sub) : developerDetail(sub);
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
