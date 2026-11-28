import { createHash } from 'node:crypto';
import { creatorGithubId, game, git } from '../config/sources.mjs';
import { isISO, isSha } from '../src/model.mjs';

async function creatorIssue(repository, number, detail) {
  const issue = await detail(`/repos/${repository}/issues/${number}`);
  if (issue?.number !== number || issue.state !== 'open' || issue.user?.id !== creatorGithubId ||
      issue.author_association !== 'OWNER' || issue.pull_request || !isISO(issue.created_at) || typeof issue.body !== 'string') {
    throw new Error('Creator ownership issue unavailable');
  }
  return { digest: createHash('sha256').update(issue.body).digest('hex'), recordedAt: issue.created_at };
}

export async function collectOwnership(registry, detail) {
  const issues = new Map();
  const records = await Promise.all(registry.filter(item => item.ownershipSource).map(async item => {
    const spec = item.ownershipSource;
    const key = `${item.repository}#${spec.issue}`;
    if (!issues.has(key)) issues.set(key, creatorIssue(item.repository, spec.issue, detail));
    try {
      const issue = await issues.get(key);
      if (issue.digest !== spec.digest) throw new Error('Ownership issue revision needs review');
      return [item.assignmentId, { workspace: spec.workspace, owner: spec.owner, assignmentState: 'assigned',
        exclusiveScopes: spec.exclusiveScopes, source: git(item.repository, `/issues/${spec.issue}`), reportedAt: issue.recordedAt }];
    } catch {
      return [item.assignmentId, null];
    }
  }));
  return new Map(records);
}

export async function readCheckpoint(assignment, spec, prior, detail) {
  const { repository, head, pr } = assignment;
  if (!head) throw new Error('Assignment commit unavailable');
  const route = `/repos/${repository}`;
  if (spec.path || spec.directory) {
    const existing = prior?.source.split('/').at(-1);
    const matchingPrior = spec.path ? prior?.source.endsWith('/' + spec.path) :
      existing && prior?.source.endsWith(`/${spec.directory}/${existing}`) && spec.pattern.test(existing);
    if (prior?.kind === 'file' && !prior.preserved && prior.observedHead === head && matchingPrior) return prior;
    const path = spec.path ?? await latestSessionPath(route, head, spec, detail);
    const query = new URLSearchParams({ sha: head, path, per_page: '1' });
    const last = (await detail(`${route}/commits?${query}`))?.[0];
    if (!isSha(last?.sha) || !isISO(last.commit?.committer?.date)) throw new Error('Checkpoint file revision unavailable');
    const file = await detail(`${route}/contents/${path}?ref=${last.sha}`);
    if (file?.type !== 'file' || file.path !== path || !isSha(file.sha)) throw new Error('Checkpoint file unavailable');
    return { kind: 'file', source: git(repository, `/blob/${last.sha}/${path}`), commit: last.sha,
      observedHead: head, recordedAt: last.commit.committer.date };
  }
  const comment = await detail(`${route}/issues/comments/${spec.comment}`);
  const source = git(repository, `/pull/${pr}#issuecomment-${spec.comment}`);
  const includesCommit = typeof comment?.body === 'string' &&
    new RegExp(`(?:^|[^a-f0-9])${spec.commit}(?:$|[^a-f0-9])`, 'i').test(comment.body);
  if (comment?.id !== spec.comment || comment.html_url !== source || comment.user?.id !== creatorGithubId ||
      comment.author_association !== 'OWNER' || !includesCommit || !isISO(comment.updated_at)) {
    throw new Error('Creator checkpoint comment unavailable');
  }
  if (head !== spec.commit) {
    const compared = await detail(`${route}/compare/${spec.commit}...${head}?per_page=1`);
    if (compared?.status !== 'ahead' || compared.merge_base_commit?.sha !== spec.commit) {
      throw new Error('Checkpoint commit is outside the current assignment history');
    }
  }
  return { kind: 'comment', source, commit: spec.commit, observedHead: head, recordedAt: comment.updated_at };
}

async function latestSessionPath(route, head, { directory, pattern }, detail) {
  const files = await detail(`${route}/contents/${directory}?ref=${head}`);
  if (!Array.isArray(files) || files.length >= 1000) throw new Error('Checkpoint directory not fully available');
  const matches = files.flatMap(file => {
    const index = Number(typeof file.name === 'string' ? file.name.match(pattern)?.[1] : NaN);
    if (!Number.isSafeInteger(index) || file.type !== 'file' || file.path !== `${directory}/${file.name}`) return [];
    return [{ path: file.path, index }];
  }).sort((a, b) => b.index - a.index);
  if (!matches.length || matches[0].index === matches[1]?.index) throw new Error('Latest checkpoint is ambiguous or unavailable');
  return matches[0].path;
}

export async function readCreatorReleaseRecord(spec, detail) {
  const source = git(game, `/pull/${spec.pull}#issuecomment-${spec.comment}`);
  const item = await detail(`/repos/${game}/issues/comments/${spec.comment}`);
  if (item?.id !== spec.comment || item.html_url !== source || item.author_association !== 'OWNER' ||
      item.user?.id !== creatorGithubId || !isISO(item.created_at) || typeof item.body !== 'string' ||
      createHash('sha256').update(item.body).digest('hex') !== spec.digest) {
    throw new Error('Creator release record needs review');
  }
  return { assignmentId: spec.assignmentId, pull: spec.pull, kind: spec.kind, commit: spec.commit, source, recordedAt: item.created_at };
}
