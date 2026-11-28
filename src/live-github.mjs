import { isSha, WORKFLOW_STATES } from './model.mjs';

const endpoint = 'https://api.github.com/repos/hdog960/Mythwrought';
export const liveRefreshInterval = 15 * 60_000;

export async function readLiveGitHub({ fetcher = fetch, now = Date.now } = {}) {
  const read = async (path, parse) => {
    try {
      const response = await fetcher(endpoint + path, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || retry) {
          const retryMs = Number(retry) * 1000 + now();
          const retryAt = Math.max(now() + liveRefreshInterval, ...[retryMs, reset * 1000].filter(Number.isFinite));
          return { value: null, retryAt };
        }
        return { value: null };
      }
      return { value: parse(await response.json()) };
    } catch {
      return { value: null };
    }
  };
  const [head, ...queues] = await Promise.all([
    read('/git/ref/heads/main', payload => payload?.ref === 'refs/heads/main' && isSha(payload.object?.sha) ? payload.object.sha : null),
    ...WORKFLOW_STATES.map(state => read(`/actions/runs?status=${state}&per_page=1`, payload => {
      const count = payload?.total_count;
      return Array.isArray(payload?.workflow_runs) && Number.isSafeInteger(count) && count >= 0 ? count : null;
    })),
  ]);
  return { observedAt: new Date(now()).toISOString(), mainHead: head.value,
    workflowCounts: Object.fromEntries(WORKFLOW_STATES.map((state, index) => [state, queues[index].value])),
    retryAt: Math.max(0, head.retryAt ?? 0, ...queues.map(queue => queue.retryAt ?? 0)) };
}
