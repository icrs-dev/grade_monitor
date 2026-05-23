const APP_BASE = (() => {
  if (import.meta.env.DEV) {
    return '';
  }
  const p = window.location.pathname;
  const dir = p.replace(/\/[^/]*\.[^/]*$/, '') || '/';
  return dir === '/' ? '' : dir;
})();

export async function api<T>(
  url: string,
  opts: RequestInit & { json?: boolean; raw?: boolean } = {}
): Promise<T> {
  const headers = new Headers(opts.headers || {});
  
  if (opts.json !== false && !headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await fetch(APP_BASE + url, {
    ...opts,
    headers,
  });

  if (opts.raw) {
    return response as unknown as T;
  }

  let data: any = {};
  try {
    data = await response.json();
  } catch (e) {
    // response has no json body
  }

  if (!response.ok) {
    throw new Error(data.detail || `请求失败 (${response.status})`);
  }

  return data as T;
}
