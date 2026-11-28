import { createHash } from 'node:crypto';
import { game, git, productionURL } from '../config/sources.mjs';
import { isSha } from '../src/model.mjs';

export function publicVersion(html) {
  const tag = html.match(/<meta\s+name=["']mythwrought-release["'][^>]{0,450}>/i)?.[0];
  const value = tag?.match(/\bcontent=["']([a-z0-9._-]{1,100})["']/i)?.[1];
  if (!value) throw new Error('Public game release identity unavailable');
  return value;
}

export async function observeProduction(fetcher, observedAt) {
  const response = await fetcher(productionURL, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Public game page unavailable');
  const html = Buffer.from(await response.arrayBuffer());
  if (html.length > 1_000_000) throw new Error('Public game response is larger than expected');
  const indexBlob = createHash('sha1').update(`blob ${html.length}\0`).update(html).digest('hex');
  return { version: publicVersion(html.toString('utf8')), observedAt, source: productionURL, indexBlob };
}

export async function matchProduction(production, deployments, detail) {
  if (!isSha(production.indexBlob)) return null;
  const eligible = deployments.filter(item => item.state === 'success' && item.target === productionURL)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const latestByHead = new Map();
  for (const item of eligible) {
    if (!latestByHead.has(item.head)) latestByHead.set(item.head, item);
  }
  const comparisons = await Promise.all([...latestByHead.values()].map(async item => {
    const file = await detail(`/repos/${game}/contents/index.html?ref=${item.head}`);
    if (file?.type !== 'file' || file.path !== 'index.html' || !isSha(file.sha)) throw new Error('Published HTML blob unavailable');
    return file.sha === production.indexBlob ? item : null;
  }));
  const matches = comparisons.filter(Boolean);
  if (matches.length !== 1 || matches[0].head !== eligible[0]?.head) return null;
  const deployment = matches[0];
  return { head: deployment.head, deploymentId: deployment.id, indexBlob: production.indexBlob,
    source: deployment.source, commitSource: git(game, `/blob/${deployment.head}/index.html`), deployedAt: deployment.updatedAt };
}
