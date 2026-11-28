export const game = 'hdog960/Mythwrought';
export const hq = 'hdog960/Mythwrought-dev-hq';
export const productionURL = 'https://hdog960.github.io/Mythwrought/';
const gitHub = 'https://github.com';
export const git = (repo, tail = '') => `${gitHub}/${repo}${tail}`;
export const creatorGithubId = 343768368;
export const qualificationWorkflows = [
  '.github/workflows/ci.yml', '.github/workflows/app-update.yml', '.github/workflows/age-of-beasts-native.yml',
  '.github/workflows/age-of-beasts-desert-visual.yml', '.github/workflows/age-of-beasts-plains-visual.yml',
  '.github/workflows/age-of-beasts-snow-visual.yml',
];

export const directives = [
  { number: 492, name: 'One world creation flow', summary: 'Route released features through the normal Create World / New World flow and preserve historical saves.' },
  { number: 498, name: 'Shared World Height', summary: 'Use the released physical world height contract of −210 through 256 within your assigned scope.' },
  { number: 501, name: 'Developer efficiency', summary: 'Reuse qualified evidence when the relevant inputs match. Run focused checks and coordinate release qualification.' },
  { number: 507, name: 'Master :00 building ownership', summary: 'Master :00 owns unfinished standalone A–D building blueprint work. The former owners’ historical work stays protected.' },
  { number: 509, name: 'Personal and Business ownership', summary: 'Keep one accountable owner per work package across both workspaces. Preserve existing assignments and use a single production integration queue. Only the creator can authorize a transfer or resolve conflicting ownership.' },
];

function assignment(id, category, name, project, options = {}) {
  const repository = options.repository ?? game;
  return { id, assignmentId: `${id}-v1`, category, name, project, repository,
    authority: 'Brief roster', status: 'Unknown', branch: null, pr: null, source: null,
    minute: null, timezone: null, reportSources: [],
    ...options };
}

const connectedScheduleObservedAt = '2026-11-27T20:30:26Z';
const connectedFluidSchedules = [
  ['water-engine', 'Water A — Engine', 'Water engine', 0, true],
  ['lava-physics', 'Lava A — Physics', 'Lava physics', 6, true],
  ['acid-physics', 'Acid A — Physics', 'Acid physics', 12, false],
  ['amber-sap-physics', 'Amber Sap A — Physics', 'Amber sap physics', 18, false],
  ['liquid-resonance-physics', 'Liquid Resonance A — Physics', 'Liquid resonance physics', 24, false],
  ['water-world', 'Water B — World & Visuals', 'Water world and visuals', 30, true],
  ['lava-world', 'Lava B — World & Visuals', 'Lava world and visuals', 36, true],
  ['acid-world', 'Acid B — World & Visuals', 'Acid world and visuals', 42, true],
  ['amber-sap-world', 'Amber Sap B — World & Visuals', 'Amber sap world and visuals', 48, true],
  ['liquid-resonance-world', 'Liquid Resonance B — World & Visuals', 'Liquid resonance world and visuals', 54, true],
];

const connectedRunObservedAt = '2026-11-27T20:32:39Z';
const connectedFluidResults = {
  'water-engine': ['2026-11-27T20:06:57.504Z', false, 'c3d6bbd92acb01d2eee5a14777fbe724ae10dcd7'],
  'lava-physics': ['2026-11-27T20:11:39.667Z', false, '87e3aefd62b50e7b3e1e0867ab64798731e6c56c'],
  'acid-physics': ['2026-11-27T20:17:43.388Z', true],
  'amber-sap-physics': ['2026-11-27T20:22:03.203Z', true],
  'liquid-resonance-physics': ['2026-11-27T20:27:31.718Z', true],
};

const ownerReport = (repository, number) => ({ repository, number, publishers: [creatorGithubId],
  creatorOwnershipPublishers: [creatorGithubId], creatorAuthorizationPublishers: [creatorGithubId] });
export const registry = [
  assignment('unified', 'manual', 'Three-in-One Developer', 'Creative, Navigation & Performance', {
    authority: 'Public developer toolkit and creator PR', status: 'Release hold', priority: 1,
    branch: 'dev/unified-creative-navigation-performance-20261126', pr: 503, source: git(game, '/pull/503'),
    reportSources: [ownerReport(game, 503)],
  }),
  assignment('beasts', 'manual', 'Mob Developer', 'Age of Beasts', {
    authority: 'Public developer toolkit and creator PR', status: 'Merge embargo', deferred: true,
    branch: 'dev/age-of-beasts-ab0-ab1-20261126', pr: 502, source: git(game, '/pull/502'),
    reportSources: [ownerReport(game, 502)],
  }),
  assignment('cave', 'manual', 'Cave Developer', 'Living Underworld', { status: 'Deferred per brief' }),
  assignment('enchanted', 'manual', 'Enchanted Forest Developer', 'Enchanted Wilds', { status: 'Deferred per brief' }),
  assignment('mountain', 'manual', 'Mountain Developer', 'Shattered Peaks', { status: 'Deferred per brief' }),
  assignment('desert', 'manual', 'Desert Developer', 'Forgotten Sands', { status: 'Deferred per brief' }),
  assignment('snow', 'manual', 'Snow Developer', 'Frostbound Expanse', { status: 'Deferred per brief' }),
  assignment('builder', 'automatic', 'Master Builder A–D', 'Standalone building blueprints', {
    authority: 'Public creator issue', minute: 0, source: git(game, '/issues/507'),
  }),
  assignment('movement', 'automatic', 'Player Movement', 'Player movement', { minute: 12 }),
  assignment('generators', 'automatic', 'Resonance Generators', 'Resonance generators', { minute: 24 }),
  assignment('networks', 'automatic', 'Resonance Networks', 'Resonance networks', { minute: 36 }),
  assignment('machinery', 'automatic', 'Resonance Machinery', 'Resonance machinery', { minute: 48 }),
  ...connectedFluidSchedules.map(([id, name, project, minute, scheduleEnabled]) => {
    const [completedAt, needsCreatorAction, commit] = connectedFluidResults[id] ?? [];
    return assignment(id, 'automatic', name, project, {
      authority: 'Verified in the connected automation account',
      minute, timezone: 'America/Chicago', scheduleEnabled, scheduleObservedAt: connectedScheduleObservedAt,
      scheduleStartsAt: `2026-11-27T20:${String(minute).padStart(2, '0')}:00Z`,
      lastSchedulerResult: completedAt ? { completedAt, needsCreatorAction, observedAt: connectedRunObservedAt,
        publicOutput: commit ? git(game, `/commit/${commit}`) : null } : null,
    });
  }),
  assignment('floating', 'codex', 'Floating Islands', 'High-altitude terrain', {
    authority: 'Project named in creator issue and HQ brief', source: git(game, '/issues/498'),
  }),
  assignment('hq', 'codex', 'Development HQ', 'Mythwrought development management', {
    repository: hq, authority: 'Creator commission and HQ release checkpoint', branch: 'main',
    source: git(hq, '/pull/1'),
    reportSources: [ownerReport(hq, 1)],
  }),
];

export const dependencies = [
  ['enchanted', 'cave', 'mountain', 'desert', 'snow'].map(id => ({
    id: `beasts-awaits-${id}`, assignment: 'beasts-v1', prerequisite: `${id}-v1`, state: 'required',
    scope: 'Merge and deployment', source: git(game, '/pull/502'),
  })),
].flat();
