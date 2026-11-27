export const game = 'hdog960/Mythwrought';
export const hq = 'hdog960/Mythwrought-dev-hq';
export const productionURL = 'https://hdog960.github.io/Mythwrought/';
const gitHub = 'https://github.com';
export const git = (repo, tail = '') => `${gitHub}/${repo}${tail}`;

export const directives = [
  { number: 492, name: 'One world creation flow', summary: 'Route released features through the normal Create World / New World flow and preserve historical saves.' },
  { number: 498, name: 'Shared World Height', summary: 'Use the released physical world height contract of −210 through 256 within your assigned scope.' },
  { number: 501, name: 'Developer efficiency', summary: 'Reuse qualified evidence when the relevant inputs match. Run focused checks and coordinate release qualification.' },
  { number: 507, name: 'Master :00 building ownership', summary: 'Master :00 owns unfinished standalone A–D building blueprint work. The former owners’ historical work stays protected.' },
];

function assignment(id, category, name, project, options = {}) {
  const repository = options.repository ?? game;
  return { id, assignmentId: `${id}-v1`, category, name, project, repository,
    authority: 'Brief roster', status: 'Unknown', branch: null, pr: null, source: null,
    minute: null, timezone: null, reportSources: [],
    ...options };
}

const owner = 343768368;
export const registry = [
  assignment('unified', 'manual', 'Three-in-One Developer', 'Creative, Navigation & Performance', {
    authority: 'Public developer toolkit and creator PR', status: 'Release hold', priority: 1,
    branch: 'dev/unified-creative-navigation-performance-20261126', pr: 503, source: git(game, '/pull/503'),
    reportSources: [{ repository: game, number: 503, publishers: [owner] }],
  }),
  assignment('beasts', 'manual', 'Mob Developer', 'Age of Beasts', {
    authority: 'Public developer toolkit and creator PR', status: 'Merge embargo', deferred: true,
    branch: 'dev/age-of-beasts-ab0-ab1-20261126', pr: 502, source: git(game, '/pull/502'),
    reportSources: [{ repository: game, number: 502, publishers: [owner] }],
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
  assignment('floating', 'codex', 'Floating Islands', 'High-altitude terrain', {
    authority: 'Project named in creator issue and HQ brief', source: git(game, '/issues/498'),
  }),
  assignment('hq', 'codex', 'Development HQ', 'Mythwrought development management', {
    repository: hq, authority: 'Creator commission and HQ repository', source: git(hq),
  }),
];

export const dependencies = [
  ['enchanted', 'cave', 'mountain', 'desert', 'snow'].map(id => ({
    id: `beasts-awaits-${id}`, assignment: 'beasts-v1', prerequisite: `${id}-v1`, state: 'required',
    scope: 'Merge and deployment', source: git(game, '/pull/502'),
  })),
].flat();
