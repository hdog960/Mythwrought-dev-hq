import { dependencies, directives, game, git, hq, productionURL, registry } from '../config/sources.mjs';
import { SNAPSHOT_VERSION, isISO, isSha, isSnapshot, sourceLink } from '../src/model.mjs';
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

  const [head, pulls, issues, workflows, releases, deployments, production, activeDirectives] = await Promise.all([
    preserve('branches', previous?.mainHead ?? null, async () => {
      const ref = await request(gamePath('/git/ref/heads/main'), 'main');
      if (ref.unchanged && previous.mainHead) return previous.mainHead;
      const value = sha(ref.data?.object?.sha);
      if (!value) throw new Error('Main reference missing');
      return value;
    }),
    preserve('pulls', previous?.pulls ?? [], async () => {
      const options = { pageSize: 50, maxPages: 2 };
      const open = await pages(gamePath('/pulls?state=open&sort=updated&direction=desc'), options);
      const closed = await pages(gamePath('/pulls?state=closed&sort=updated&direction=desc'), { pageSize: 30, maxPages: 1 });
      const pinned = await Promise.all(registry.filter(item => item.pr).map(item => detail(gamePath(`/pulls/${item.pr}`))));
      if (open.limited) mark('pulls', 'partial', 'Newest 100 open PRs, registered PRs, and 30 recently updated closed PRs');
      return unique([...open.items, ...closed.items, ...pinned].map(pull), 'number')
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
    preserve('directives', previous?.directives ?? [], async () => {
      return await Promise.all(directives.map(async row => {
        const key = `directive-${row.number}`;
        const response = await request(gamePath(`/issues/${row.number}`), key);
        if (response.unchanged) {
          const prior = previous.directives.find(item => item.number === row.number);
          if (prior) return prior;
          throw new Error('Missing prior directive');
        }
        const record = response.data;
        return { ...row, source: git(game, `/issues/${row.number}`), updatedAt: date(record.updated_at),
          state: record.author_association === 'OWNER' && record.state === 'open' ? 'Creator source confirmed' : 'Review source' };
      }));
    }),
  ]);

  function candidateFor(developer) {
    return pulls.find(item => item.number === developer.pr && item.branch === developer.branch && item.headRepositoryMatches) ?? null;
  }

  const developers = await preserve('registeredBranches', previous?.developers ?? registry.map(publicAssignment), async () => {
    const resolved = await Promise.all(registry.map(async developer => {
      const projected = publicAssignment(developer);
      if (!developer.branch) return projected;
      const candidate = candidateFor(developer);
      const key = `branch-${developer.id}`;
      const prior = previous?.developers.find(item => item.assignmentId === developer.assignmentId);
      const result = await request(pathFor(developer.repository, `/branches/${encodeURIComponent(developer.branch)}`), key);
      const head = result.unchanged ? prior?.branchHead : sha(result.data?.commit?.sha);
      if (!developer.pr) return { ...projected, branchHead: head ?? null, head: head ?? null,
        headStatus: head ? 'Repository branch confirmed' : 'Branch unavailable' };
      return { ...projected, branchHead: head ?? null, head: candidate?.head === head ? head : null,
        headStatus: head && head === candidate?.head ? 'PR and branch match' : 'PR and branch differ' };
    }));
    if (resolved.some(item => item.branch && !item.head)) mark('registeredBranches', 'partial', 'One or more registered branches or PR heads could not be confirmed');
    return resolved;
  });

  const checks = await preserve('checks', previous?.checks ?? [], async () => {
    const contexts = new Map();
    const result = [];
    for (const developer of developers.filter(item => item.head && item.pr)) {
      const candidate = candidateFor(developer);
      const base = candidate.baseBranch;
      if (!contexts.has(base)) {
        try {
          const protection = await detail(gamePath(`/branches/${encodeURIComponent(base)}/protection/required_status_checks`));
          contexts.set(base, protection.checks?.length ? protection.checks : (protection.contexts ?? []).map(context => ({ context })));
        } catch { contexts.set(base, null); }
      }
      const required = contexts.get(base);
      const found = await pages(gamePath(`/commits/${candidate.head}/check-runs?filter=latest`), { unwrap: data => data.check_runs });
      result.push(...found.items.map(item => check(item, candidate, required ?? [], Boolean(required))).filter(Boolean));
      if (!required || found.limited) mark('checks', 'partial', 'Required check rules or part of the check inventory are inaccessible');
    }
    return result;
  });

  const previousReports = previous?.reports ?? [];
  const reports = await preserve('reports', previousReports, async () => {
    const registered = registry.flatMap(developer => developer.reportSources.map(source => ({ developer, source })));
    if (registered.length === 0) {
      mark('reports', 'partial', 'No approved report sources are configured');
      return previousReports;
    }
    const incorporated = [];
    const keys = new Set(previousReports.map(reportKey));
    let checksLeft = 16;
    for (const { developer, source } of registered) {
      const cursor = `${developer.assignmentId}/${source.repository}/${source.number}`;
      const since = reportsSince[cursor] ?? null;
      let fetched;
      try {
        fetched = await pages(pathFor(source.repository, `/issues/${source.number}/comments`), { maxPages: 3, since });
      } catch {
        mark('reports', 'partial', 'One or more registered comments feeds are unavailable');
        continue;
      }
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
      if (incomplete) mark('reports', 'partial', 'Report backlog or temporarily unverifiable commit');
      else reportsSince[cursor] = new Date(now.getTime() - 60_000).toISOString();
    }
    return appendReports(previousReports, incorporated);
  });

  const collectionSucceeded = Boolean(head && sources.branches.state === 'ok' && sources.pulls.state !== 'error');
  health.lastSuccess = collectionSucceeded ? attemptedAt : previous?.health.lastSuccess ?? null;
  health.rateLimit = client.rate;
  const snapshot = { schemaVersion: SNAPSHOT_VERSION, generatedAt: attemptedAt, health,
    mainHead: head, developers, pulls, issues, workflows, checks, releases, deployments, production,
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
