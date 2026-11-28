import { creatorGithubId, dependencies, directives, game, git, hq, productionURL, qualificationWorkflows, registry } from '../config/sources.mjs';
import { SNAPSHOT_VERSION, WORKFLOW_STATES, isISO, isSha, isSnapshot, sourceLink } from '../src/model.mjs';
import { createGitHub } from './github.mjs';
import { appendReports, parseReport, publicText, reportKey } from './report.mjs';

const pathFor = (repo, path) => `/repos/${repo}${path}`;
const gamePath = path => pathFor(game, path);
const text = (value, max) => publicText(value, max);
const date = value => isISO(value) ? value : null;
const sha = value => isSha(value) ? value : null;
const pos = value => Number.isSafeInteger(value) && value > 0;

function pull(row) {
  if (!pos(row.number) || !sha(row.head?.sha) || !sha(row.base?.sha) || !row.head?.ref) return null;
  return { number: row.number, title: text(row.title) ?? `Pull request #${row.number}`, head: row.head.sha,
    branch: text(row.head.ref, 160), base: row.base.sha, baseBranch: text(row.base.ref, 160),
    headRepositoryMatches: row.head.repo?.full_name?.toLowerCase() === game.toLowerCase(),
    state: row.merged_at ? 'merged' : row.state === 'open' ? 'open' : 'closed',
    draft: row.draft === true, mergeCommit: row.merged_at ? sha(row.merge_commit_sha) : null,
    updatedAt: date(row.updated_at), mergedAt: date(row.merged_at), source: git(game, `/pull/${row.number}`) };
}

function issue(row) {
  if (row.pull_request || !pos(row.number)) return null;
  return { number: row.number, title: text(row.title) ?? `Issue #${row.number}`,
    state: row.state === 'open' ? 'open' : 'closed', updatedAt: date(row.updated_at),
    source: git(game, `/issues/${row.number}`) };
}

function run(row) {
  if (!pos(row.id) || !sha(row.head_sha)) return null;
  return { id: row.id, title: text(row.name) ?? 'Workflow', head: row.head_sha, branch: text(row.head_branch, 160),
    status: text(row.status, 40), conclusion: text(row.conclusion, 40), event: text(row.event, 50),
    qualification: qualificationWorkflows.includes(row.path?.split('@')[0]),
    updatedAt: date(row.updated_at), source: git(game, `/actions/runs/${row.id}`) };
}

function check(row, candidate, required, mandatoryContextKnown) {
  if (!pos(row.id) || row.head_sha !== candidate.head || !text(row.name)) return null;
  const requirement = required.find(rule => rule.context === row.name &&
    (!pos(rule.app_id) || rule.app_id === row.app?.id));
  const link = sourceLink(row.html_url);
  return { id: row.id, number: candidate.number, title: text(row.name), head: candidate.head,
    status: text(row.status, 40), conclusion: text(row.conclusion, 40),
    mandatory: requirement ? true : mandatoryContextKnown ? false : null,
    updatedAt: date(row.completed_at ?? row.started_at), source: link ?? candidate.source };
}

async function requiredChecks(base, detail) {
  if (!base) return { checks: [], complete: false };
  const branch = encodeURIComponent(base);
  const [legacy, rules] = await Promise.allSettled([
    detail(gamePath(`/branches/${branch}/protection/required_status_checks`)),
    detail(gamePath(`/rules/branches/${branch}`)),
  ]);
  const protection = legacy.status === 'fulfilled' ? legacy.value : null;
  const legacyChecks = Array.isArray(protection?.checks) && protection.checks.length ? protection.checks :
    Array.isArray(protection?.contexts) ? protection.contexts.map(context => ({ context })) : null;
  const activeRules = rules.status === 'fulfilled' && Array.isArray(rules.value) ? rules.value : null;
  const ruleChecks = activeRules?.filter(rule => rule?.type === 'required_status_checks')
    .map(rule => rule.parameters?.required_status_checks);
  const rulesKnown = Boolean(ruleChecks?.every(Array.isArray));
  const contexts = (legacyChecks ?? []).concat((ruleChecks ?? []).flatMap(rows => Array.isArray(rows) ?
    rows.map(row => ({ context: row?.context, app_id: row?.integration_id })) : []));
  return {
    checks: contexts.filter(row => text(row?.context)),
    complete: Boolean(legacyChecks && rulesKnown),
  };
}

function release(row) {
  if (!pos(row.id) || row.draft) return null;
  return { id: row.id, name: text(row.name) ?? text(row.tag_name) ?? 'GitHub release',
    tag: text(row.tag_name, 100), prerelease: row.prerelease === true, publishedAt: date(row.published_at),
    source: sourceLink(row.html_url) ?? git(game, '/releases') };
}

function unique(items, key) {
  return [...new Map(items.filter(Boolean).map(item => [item[key], item])).values()];
}

function expectedRefresh(now) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  let minute = (7 - next.getUTCMinutes() + 60) % 10;
  if (!minute) minute = 10;
  next.setUTCMinutes(next.getUTCMinutes() + minute);
  return next.toISOString();
}

export function publicVersion(html) {
  const tag = html.match(/<meta\s+name=["']mythwrought-release["'][^>]{0,450}>/i)?.[0];
  const value = tag?.match(/\bcontent=["']([a-z0-9._-]{1,100})["']/i)?.[1];
  if (!value) throw new Error('Public game release identity unavailable');
  return value;
}

export async function collect({ previous, state, token, fetcher = fetch, now = new Date() } = {}) {
  previous = isSnapshot(previous) ? previous : null;
  const attemptedAt = now.toISOString();
  const client = createGitHub({ token, fetcher, previousTags: state?.tags });
  const sources = {};
  const health = { lastAttempt: attemptedAt, lastSuccess: null, nextExpected: expectedRefresh(now), rateLimit: null, sources };
  const reportsSince = { ...state?.reportsSince };
  const request = (route, key = null) => client.request(route, previous ? key : null);
  const detail = async route => (await request(route)).data;
  const pages = (route, options) => client.pages(route, options);
  const oldSource = name => previous?.health.sources[name]?.lastSuccess ?? null;
  const mark = (name, stateValue, note = null) => {
    sources[name] = { state: stateValue, lastSuccess: stateValue === 'ok' || stateValue === 'partial' ? attemptedAt : oldSource(name), note };
  };

  async function preserve(name, fallback, fn) {
    try {
      const result = await fn();
      if (!sources[name]) mark(name, 'ok');
      return result;
    } catch (error) {
      const status = Number.isInteger(error.status) ? ` (HTTP ${error.status})` : '';
      mark(name, 'error', `Source unavailable${status}`);
      return fallback;
    }
  }

  const observedPulls = new Set();
  const [head, pulls, issues, workflows, releases, deployments, production, activeWorkflowLoad, activeDirectives, schedule] = await Promise.all([
    preserve('branches', previous?.mainHead ?? null, async () => {
      const ref = await request(gamePath('/git/ref/heads/main'), 'main');
      if (ref.unchanged && previous.mainHead) return previous.mainHead;
      const value = sha(ref.data?.object?.sha);
      if (!value) throw new Error('Main reference missing');
      return value;
    }),
    preserve('pulls', previous?.pulls ?? [], async () => {
      const options = { pageSize: 50, maxPages: 2 };
      const pinnedNumbers = [...new Set(registry.map(item => item.pr).filter(Boolean))];
      const [open, closed, ...pinned] = await Promise.allSettled([
        pages(gamePath('/pulls?state=open&sort=updated&direction=desc'), options),
        pages(gamePath('/pulls?state=closed&sort=updated&direction=desc'), { pageSize: 30, maxPages: 1 }),
        ...pinnedNumbers.map(number => detail(gamePath(`/pulls/${number}`))),
      ]);
      // Read the closed list before the open list so duplicate list rows favor open;
      // a registered detail response takes precedence over either list.
      const current = unique([
        ...(closed.value?.items ?? []), ...(open.value?.items ?? []),
        ...pinned.map((item, index) => item.value?.number === pinnedNumbers[index] ? item.value : null),
      ].filter(Boolean).map(pull), 'number');
      current.forEach(item => observedPulls.add(item.number));
      const notes = [];
      if (!open.value) notes.push('Open PR list unavailable');
      else if (open.value.limited) notes.push('Open PR list capped at 100');
      if (!closed.value) notes.push('Recently closed PR list unavailable');
      if (pinnedNumbers.some(number => !observedPulls.has(number))) notes.push('Some registered PRs unavailable');
      if (notes.length) mark('pulls', !open.value && !closed.value && !current.length ? 'error' : 'partial', notes.join('. '));
      const saved = (previous?.pulls ?? []).filter(item => !observedPulls.has(item.number) &&
        (pinnedNumbers.includes(item.number) || (item.state === 'open' ? !open.value : !closed.value)));
      return [...current, ...saved]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }),
    preserve('issues', previous?.issues ?? [], async () => {
      const result = await pages(gamePath('/issues?state=all&sort=updated&direction=desc'), { maxPages: 2, pageSize: 50 });
      return result.items.map(issue).filter(Boolean);
    }),
    preserve('workflows', previous?.workflows ?? [], async () => {
      const result = await pages(gamePath('/actions/runs'), { unwrap: data => data.workflow_runs, maxPages: 1, pageSize: 40 });
      return result.items.map(run).filter(Boolean);
    }),
    preserve('releases', previous?.releases ?? [], async () => {
      const result = await pages(gamePath('/releases'), { maxPages: 1, pageSize: 15 });
      return result.items.map(release).filter(Boolean);
    }),
    preserve('deployments', previous?.deployments ?? [], async () => {
      const result = await pages(gamePath('/deployments?environment=github-pages'), { maxPages: 1, pageSize: 5 });
      return await Promise.all(result.items.filter(item => pos(item.id) && sha(item.sha)).map(async item => {
        const statuses = await pages(gamePath(`/deployments/${item.id}/statuses`), { maxPages: 1, pageSize: 1 });
        const latest = statuses.items[0];
        const target = sourceLink(latest?.environment_url);
        return { id: item.id, head: item.sha, state: text(latest?.state, 40), createdAt: date(item.created_at),
          updatedAt: date(latest?.updated_at ?? latest?.created_at), environment: 'github-pages',
          target: target === productionURL ? target : null,
          source: sourceLink(latest?.log_url) ?? git(game, '/deployments') };
      }));
    }),
    preserve('production', previous?.production ?? { version: null, observedAt: null, source: productionURL }, async () => {
      const response = await fetcher(productionURL, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error('Public game page unavailable');
      const html = await response.text();
      if (html.length > 1_000_000) throw new Error('Public game response is larger than expected');
      return { version: publicVersion(html), observedAt: attemptedAt, source: productionURL };
    }),
    Promise.all(WORKFLOW_STATES.map(async status => [
      status,
      await preserve('workflowLoad:' + status, previous?.workflowLoad?.[status] ?? null, async () => {
        const result = await detail(gamePath(`/actions/runs?status=${status}&per_page=50`));
        if (!Number.isSafeInteger(result?.total_count) || result.total_count < 0 || !Array.isArray(result.workflow_runs)) {
          throw new Error('Workflow count unavailable');
        }
        const runs = unique(result.workflow_runs.filter(item => item?.status === status).map(run), 'id');
        if (runs.length > result.total_count) throw new Error('Workflow count was inconsistent');
        if (runs.length < result.total_count) mark('workflowLoad:' + status, 'partial',
          `GitHub reported ${result.total_count} runs and returned ${runs.length} matching details. HQ requests up to 50 details.`);
        return { total: result.total_count, observedAt: attemptedAt, runs };
      }),
    ])).then(Object.fromEntries),
    preserve('directives', previous?.directives ?? [], async () => {
      const results = await Promise.all(directives.map(async row => {
        const key = `directive-${row.number}`;
        const prior = previous?.directives.find(item => item.number === row.number);
        const source = git(game, `/issues/${row.number}`);
        try {
          const response = await request(gamePath(`/issues/${row.number}`),
            prior && prior.state !== 'Source unavailable' ? key : null);
          if (response.unchanged) return { ...prior, ...row };
          const record = response.data;
          if (record.number !== row.number || typeof record.state !== 'string') throw new Error('Directive identity unavailable');
          return { ...row, source, updatedAt: date(record.updated_at),
            state: record.user?.id === creatorGithubId && record.author_association === 'OWNER' &&
              record.state === 'open' ? 'Creator source confirmed' : 'Review source' };
        } catch {
          return { ...row, source, updatedAt: prior?.updatedAt ?? null, state: 'Source unavailable' };
        }
      }));
      const missing = results.filter(item => item.state === 'Source unavailable').length;
      if (missing) mark('directives', missing === results.length ? 'error' : 'partial', `${missing} directive sources unavailable`);
      return results;
    }),
    preserve('schedule', previous?.schedule ?? null, async () => {
      const result = await detail(pathFor(hq, '/actions/workflows/hq-pages.yml/runs?event=schedule&per_page=1'));
      if (!Array.isArray(result?.workflow_runs)) throw new Error('Schedule run history unavailable');
      const latest = result.workflow_runs[0];
      if (!latest && result.total_count === 0) return { latest: null };
      if (!pos(latest?.id) || latest.event !== 'schedule' || !date(latest.created_at)) throw new Error('Scheduled run unavailable');
      return { latest: { createdAt: latest.created_at, status: text(latest.status, 40), conclusion: text(latest.conclusion, 40),
        source: git(hq, `/actions/runs/${latest.id}`) } };
    }),
  ]);

  function candidateFor(developer) {
    return pulls.find(item => item.number === developer.pr && observedPulls.has(item.number) &&
      item.branch === developer.branch && item.headRepositoryMatches) ?? null;
  }

  const developers = await preserve('registeredBranches', previous?.developers ?? registry.map(publicAssignment), async () => {
    const resolved = await Promise.all(registry.map(async developer => {
      const projected = publicAssignment(developer);
      if (!developer.branch) return projected;
      const candidate = candidateFor(developer);
      const key = `branch-${developer.id}`;
      const prior = previous?.developers.find(item => item.assignmentId === developer.assignmentId &&
        item.repository === developer.repository && item.branch === developer.branch);
      try {
        const result = await request(pathFor(developer.repository, `/branches/${encodeURIComponent(developer.branch)}`),
          sha(prior?.branchHead) ? key : null);
        const head = result.unchanged ? prior.branchHead : sha(result.data?.commit?.sha);
        if (!head) throw new Error('Branch HEAD unavailable');
        const matches = !developer.pr || head === candidate?.head;
        return { ...projected, branchHead: head, branchObservedAt: attemptedAt, head: matches ? head : null,
          headStatus: !developer.pr ? 'Repository branch confirmed' : matches ? 'PR and branch match' :
            candidate ? 'PR and branch differ' : 'Registered PR unavailable' };
      } catch {
        return { ...projected, branchHead: prior?.branchHead ?? null, branchObservedAt: prior?.branchObservedAt ?? null,
          headStatus: 'Branch unavailable' };
      }
    }));
    const known = resolved.filter(item => item.branch);
    const unverified = known.filter(item => !item.head).length;
    if (unverified) mark('registeredBranches', unverified === known.length ? 'error' : 'partial',
      `${unverified} of ${known.length} registered assignment HEADs could not be confirmed`);
    return resolved;
  });

  const checks = await preserve('checks', [], async () => {
    const contexts = new Map();
    const inventories = new Map();
    const candidates = developers.filter(item => item.head && item.pr);
    const results = await Promise.all(candidates.map(async developer => {
      const candidate = candidateFor(developer);
      const base = candidate.baseBranch;
      if (!contexts.has(base)) contexts.set(base, requiredChecks(base, detail));
      if (!inventories.has(candidate.head)) inventories.set(candidate.head,
        pages(gamePath(`/commits/${candidate.head}/check-runs?filter=latest`), { unwrap: data => data.check_runs }));
      try {
        const [required, found] = await Promise.all([contexts.get(base), inventories.get(candidate.head)]);
        const checks = found.items.map(item => check(item, candidate, required.checks, required.complete)).filter(Boolean);
        return { checks, complete: required.complete && !found.limited };
      } catch {
        const saved = (previous?.checks ?? []).filter(item => item.number === candidate.number && item.head === candidate.head);
        return { checks: saved.map(item => ({ ...item, mandatory: null, preserved: true })), complete: false, unavailable: true };
      }
    }));
    if (results.some(item => !item.complete) || candidates.length !== registry.filter(item => item.pr).length) {
      mark('checks', !results.length || results.every(item => item.unavailable) ? 'error' : 'partial',
        'Some PR heads, check results or required check rules could not be verified');
    }
    return results.flatMap(item => item.checks);
  });

  const previousReports = previous?.reports ?? [];
  const feedResults = new Map(registry.map(item => [item.assignmentId, []]));
  const reports = await preserve('reports', previousReports, async () => {
    const registered = registry.flatMap(developer => developer.reportSources.map(source => ({ developer, source })));
    if (registered.length === 0) {
      mark('reports', 'partial', 'No approved report sources are configured');
      return previousReports;
    }
    const incorporated = [];
    const keys = new Set(previousReports.map(reportKey));
    let checksLeft = 16;
    let feedsRead = 0;
    for (const { developer, source } of registered) {
      const cursor = `${developer.assignmentId}/${source.repository}/${source.number}`;
      const statuses = feedResults.get(developer.assignmentId);
      const since = reportsSince[cursor] ?? null;
      let fetched;
      try {
        fetched = await pages(pathFor(source.repository, `/issues/${source.number}/comments`), { maxPages: 3, since });
      } catch {
        statuses.push('unavailable');
        continue;
      }
      feedsRead++;
      let incomplete = fetched.limited;
      for (const row of fetched.items) {
        const parsed = parseReport(row.body, developer, source, {
          publisher: row.user?.id, createdAt: row.created_at, url: row.html_url,
        });
        if (!parsed || keys.has(reportKey(parsed))) continue;
        if (!checksLeft) { incomplete = true; break; }
        checksLeft--;
        try {
          if (!await verifyReport(parsed, developers, detail)) continue;
          incorporated.push(parsed);
          keys.add(reportKey(parsed));
        } catch {
          incomplete = true;
        }
      }
      statuses.push(incomplete ? 'partial' : 'ok');
      if (incomplete) mark('reports', 'partial', 'Report backlog or temporarily unverifiable commit');
      else reportsSince[cursor] = new Date(now.getTime() - 60_000).toISOString();
    }
    if (feedsRead < registered.length) mark('reports', feedsRead ? 'partial' : 'error',
      `${registered.length - feedsRead} registered comment feeds unavailable`);
    return appendReports(previousReports, incorporated);
  });

  const collectionSucceeded = Boolean(head && sources.branches.state === 'ok' && sources.pulls.state !== 'error');
  health.lastSuccess = collectionSucceeded ? attemptedAt : previous?.health.lastSuccess ?? null;
  health.rateLimit = client.rate;
  const ownership = new Map();
  for (const report of reports) {
    if (report.ownership) ownership.set(report.assignmentId, {
      ...report.ownership, source: report.source, reportedAt: report.reportedAt,
    });
  }
  const snapshot = { schemaVersion: SNAPSHOT_VERSION, generatedAt: attemptedAt, health,
    mainHead: head, developers: developers.map(item => {
      const statuses = feedResults.get(item.assignmentId);
      const reportFeedState = !statuses.length ? null : statuses.every(state => state === 'ok') ? 'ok' :
        statuses.every(state => state === 'unavailable') ? 'unavailable' : 'partial';
      return { ...item, reportFeedState, ownership: ownership.get(item.assignmentId) ?? null };
    }),
    pulls, issues, workflows, workflowLoad: activeWorkflowLoad, checks, releases, deployments, production, schedule,
    reports, directives: activeDirectives, dependencies };
  if (!isSnapshot(snapshot)) throw new Error('Collector produced an invalid snapshot');
  return { snapshot, state: { tags: client.tags, reportsSince }, collectionSucceeded, canPublish: Boolean(health.lastSuccess) };
}

function publicAssignment({ reportSources, ...record }) {
  return { ...record, registeredSources: reportSources.map(source => git(source.repository, `/issues/${source.number}`)),
    head: null, branchHead: null, headStatus: 'Unknown' };
}

async function verifyReport(report, developers, detail) {
  const assignment = developers.find(item => item.assignmentId === report.assignmentId);
  if (assignment?.head === report.commit) return true;
  const route = pathFor(report.repository, `/compare/${report.commit}...${encodeURIComponent(report.branch)}?per_page=1`);
  const compared = await detail(route);
  return ['identical', 'ahead'].includes(compared.status) && compared.merge_base_commit?.sha === report.commit &&
    compared.base_commit?.sha === report.commit;
}

export { game, hq };
