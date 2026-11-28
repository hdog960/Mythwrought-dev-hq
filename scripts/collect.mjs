import { creatorGithubId, creatorReleaseRecords, dependencies, directives, game, git, hq, productionURL, qualificationWorkflows, registry } from '../config/sources.mjs';
import { SNAPSHOT_VERSION, WORKFLOW_STATES, isISO, isSha, isSnapshot, sourceLink } from '../src/model.mjs';
import { createGitHub } from './github.mjs';
import { appendReports, parseReport, publicText, reportKey } from './report.mjs';
import { collectOwnership, readCheckpoint, readCreatorReleaseRecord } from './checkpoints.mjs';
import { qualificationInventory, reconcileQualification, requiredChecks } from './qualification.mjs';
import { matchProduction, observeProduction } from './publication.mjs';
export { publicVersion } from './publication.mjs';

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
        const statuses = await pages(gamePath(`/deployments/${item.id}/statuses`), { maxPages: 1, pageSize: 5 });
        const latest = statuses.items[0];
        const successful = statuses.items.find(status => status.state === 'success' && sourceLink(status.environment_url) === productionURL);
        const target = sourceLink(latest?.environment_url);
        return { id: item.id, head: item.sha, state: text(latest?.state, 40), createdAt: date(item.created_at),
          updatedAt: date(latest?.updated_at ?? latest?.created_at), environment: 'github-pages',
          target: target === productionURL ? target : null,
          lastSuccessAt: date(successful?.updated_at ?? successful?.created_at),
          lastSuccessSource: sourceLink(successful?.log_url),
          source: sourceLink(latest?.log_url) ?? git(game, '/deployments') };
      }));
    }),
    preserve('production', previous?.production ?? { version: null, observedAt: null, source: productionURL },
      () => observeProduction(fetcher, attemptedAt)),
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
      const result = await detail(pathFor(hq, '/actions/workflows/hq-pages.yml/runs?event=schedule&per_page=10'));
      if (!Array.isArray(result?.workflow_runs)) throw new Error('Schedule run history unavailable');
      const latest = result.workflow_runs[0];
      if (!latest && result.total_count === 0) return { latest: null };
      function scheduledRun(item) {
        if (!pos(item?.id) || item.event !== 'schedule' || !date(item.created_at)) throw new Error('Scheduled run unavailable');
        return { createdAt: item.created_at, status: text(item.status, 40), conclusion: text(item.conclusion, 40),
          source: git(hq, `/actions/runs/${item.id}`) };
      }
      const completed = result.workflow_runs.find(item => item.status === 'completed');
      return { latest: scheduledRun(latest), lastCompleted: completed ? scheduledRun(completed) : null };
    }),
  ]);

  const [publication, releaseRecords] = await Promise.all([
    preserve('publication', null, async () => {
      if (sources.production.state !== 'ok' || sources.deployments.state !== 'ok') throw new Error('Publication evidence unavailable');
      const match = await matchProduction(production, deployments, detail);
      if (!match) mark('publication', 'partial', 'Public HTML did not resolve to one latest successful Pages commit');
      return match;
    }),
    preserve('releaseRecords', [], async () => {
      const found = await Promise.allSettled(creatorReleaseRecords.map(spec => readCreatorReleaseRecord(spec, detail)));
      const records = found.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
      if (records.length < found.length) mark('releaseRecords', records.length ? 'partial' : 'error', 'Creator release records need review');
      return records;
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

  const [registeredOwnership, checkpoints, reviews] = await Promise.all([
    preserve('ownership', new Map(), async () => {
      const records = await collectOwnership(registry, detail);
      const available = [...records.values()].filter(Boolean).length;
      if (available < records.size) mark('ownership', available ? 'partial' : 'error',
        `${records.size - available} ownership records unavailable or need review`);
      return records;
    }),
    preserve('checkpoints', new Map(), async () => {
      const enrolled = registry.filter(item => item.checkpointSource);
      const records = await Promise.all(enrolled.map(async item => {
        const assignment = developers.find(developer => developer.assignmentId === item.assignmentId);
        const prior = previous?.developers.find(developer => developer.assignmentId === item.assignmentId &&
          developer.branch === item.branch)?.publicCheckpoint;
        try {
          return [item.assignmentId, await readCheckpoint(assignment, item.checkpointSource, prior, detail)];
        } catch {
          return [item.assignmentId, prior ? { ...prior, preserved: true } : null];
        }
      }));
      const available = records.filter(([, record]) => record && !record.preserved).length;
      if (available < records.length) mark('checkpoints', available ? 'partial' : 'error',
        `${records.length - available} enrolled checkpoints could not be verified`);
      return new Map(records);
    }),
    preserve('reviews', new Map(), async () => {
      const candidates = developers.filter(item => item.head && item.pr).map(candidateFor)
        .filter(item => item?.state === 'open' && !item.draft);
      const records = await Promise.all(candidates.map(async item => {
        const source = git(game, `/pull/${item.number}`);
        try {
          const data = await detail(gamePath(`/pulls/${item.number}/requested_reviewers`));
          if (!Array.isArray(data.users) || !Array.isArray(data.teams)) throw new Error('Review requests unavailable');
          return [item.number, { head: item.head, requested: data.users.length + data.teams.length, source }];
        } catch {
          return [item.number, { head: item.head, requested: null, source }];
        }
      }));
      const missing = records.filter(([, record]) => record.requested === null).length;
      if (missing) mark('reviews', missing === records.length ? 'error' : 'partial', `${missing} PR review queues unavailable`);
      return new Map(records);
    }),
  ]);

  const requiredGates = new Map();
  const checks = await preserve('checks', [], async () => {
    const contexts = new Map();
    const inventories = new Map();
    const candidates = developers.filter(item => item.head && item.pr);
    const results = await Promise.all(candidates.map(async developer => {
      const candidate = candidateFor(developer);
      const base = candidate.baseBranch;
      if (!contexts.has(base)) contexts.set(base, requiredChecks(base, detail));
      if (!inventories.has(candidate.head)) inventories.set(candidate.head, qualificationInventory(candidate.head, pages));
      const [required, inventory] = await Promise.all([contexts.get(base), inventories.get(candidate.head)]);
      const result = reconcileQualification(candidate, required, inventory, previous?.checks);
      requiredGates.set(developer.assignmentId, { head: candidate.head, ...result.gate });
      return result;
    }));
    if (results.some(item => !item.complete) || candidates.length !== registry.filter(item => item.pr).length) {
      mark('checks', !results.length || results.every(item => !item.readable) ? 'error' : 'partial',
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
  const ownership = new Map(registeredOwnership);
  for (const report of reports) {
    if (report.ownership && report.reportedAt >= (ownership.get(report.assignmentId)?.reportedAt ?? '')) ownership.set(report.assignmentId, {
      ...report.ownership, source: report.source, reportedAt: report.reportedAt,
    });
  }
  const snapshot = { schemaVersion: SNAPSHOT_VERSION, generatedAt: attemptedAt, health,
    mainHead: head, developers: developers.map(item => {
      const statuses = feedResults.get(item.assignmentId);
      const reportFeedState = !statuses.length ? null : statuses.every(state => state === 'ok') ? 'ok' :
        statuses.every(state => state === 'unavailable') ? 'unavailable' : 'partial';
      return { ...item, reportFeedState, ownership: ownership.get(item.assignmentId) ?? null,
        publicCheckpoint: checkpoints.get(item.assignmentId) ?? null,
        review: reviews.get(item.pr) ?? null, requiredGate: requiredGates.get(item.assignmentId) ?? null };
    }),
    pulls, issues, workflows, workflowLoad: activeWorkflowLoad, checks, releases, deployments, production, publication, releaseRecords, schedule,
    reports, directives: activeDirectives, dependencies };
  if (!isSnapshot(snapshot)) throw new Error('Collector produced an invalid snapshot');
  return { snapshot, state: { tags: client.tags, reportsSince }, collectionSucceeded, canPublish: Boolean(health.lastSuccess) };
}

function publicAssignment({ reportSources, ownershipSource, checkpointSource, ...record }) {
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
