const API = 'https://api.github.com';
const USER_AGENT = 'mythwrought-development-hq';
const MAX_RETRIES = 2;

function statusError(status, url) {
  const error = new Error(`HTTP ${status} from ${new URL(url).pathname}`);
  error.status = status;
  return error;
}

export function createGitHub({ token, previousTags = {}, fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const tags = {};
  let rate = null;
  async function request(route, cacheKey = null, useToken = true) {
    const url = new URL(route, API);
    if (url.origin !== API) throw new Error('Unexpected GitHub API origin');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': USER_AGENT };
      if (useToken && token) headers.Authorization = `Bearer ${token}`;
      if (cacheKey && previousTags[cacheKey]) headers['If-None-Match'] = previousTags[cacheKey];
      let response;
      try {
        response = await fetcher(url, { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' });
      } catch (error) {
        if (attempt === MAX_RETRIES) throw error;
        await wait(400 * 2 ** attempt);
        continue;
      }
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetAt = response.headers.get('x-ratelimit-reset');
      if (remaining !== null && resetAt !== null) rate = { remaining: Number(remaining), resetAt: Number(resetAt) };
      if (response.status === 304) {
        if (cacheKey) tags[cacheKey] = previousTags[cacheKey];
        return { unchanged: true };
      }
      if (response.ok) {
        const tag = response.headers.get('etag');
        if (cacheKey && tag) tags[cacheKey] = tag;
        return { data: await response.json(), link: response.headers.get('link') };
      }
      if (useToken && token && [401, 403, 404].includes(response.status) && remaining !== '0' && !response.headers.has('retry-after')) {
        return request(route, null, false);
      }
      if (attempt === MAX_RETRIES || remaining === '0' || (![429, 500, 502, 503, 504].includes(response.status)
        && !(response.status === 403 && response.headers.has('retry-after')))) throw statusError(response.status, url);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter && (!/^\d+$/.test(retryAfter) || Number(retryAfter) > 8)) throw statusError(response.status, url);
      await wait(retryAfter ? Number(retryAfter) * 1000 : 400 * 2 ** attempt);
    }
  }
  async function pages(route, { maxPages = 2, unwrap = value => value, pageSize = 100, since = null } = {}) {
    const first = new URL(route, API);
    first.searchParams.set('per_page', pageSize);
    if (since) first.searchParams.set('since', since);
    const items = [];
    let next = first.href;
    for (let page = 0; next && page < maxPages; page++) {
      const response = await request(next);
      const data = unwrap(response.data);
      if (!Array.isArray(data)) throw new Error('Unexpected paginated GitHub response');
      items.push(...data);
      next = response.link?.match(/<([^>]+)>; rel="next"/)?.[1] ?? null;
    }
    return { items, limited: Boolean(next) };
  }
  return { request, pages, tags, get rate() { return rate; } };
}
