const APP_BASE = (() => {
  if (import.meta.env.DEV) {
    return '';
  }
  const p = window.location.pathname;
  const dir = p.replace(/\/[^/]*\.[^/]*$/, '') || '/';
  return dir === '/' ? '' : dir;
})();

const ADMIN_KEY_STORAGE = 'cloudmarking_admin_key';

export function getAdminKey(): string | null {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE);
}

export function setAdminKey(key: string): void {
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function clearAdminKey(): void {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}

export function hasAdminKey(): boolean {
  return !!getAdminKey();
}

const SESSION_ID_KEY = 'cloudmarking_sid';

export function getSessionId(): string | null {
  return sessionStorage.getItem(SESSION_ID_KEY);
}

export function setSessionId(sid: string): void {
  sessionStorage.setItem(SESSION_ID_KEY, sid);
}

export function clearSessionId(): void {
  sessionStorage.removeItem(SESSION_ID_KEY);
}

export async function api<T>(
  url: string,
  opts: RequestInit & { json?: boolean; raw?: boolean } = {}
): Promise<T> {
  const headers = new Headers(opts.headers || {});

  if (opts.json !== false && !headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const adminKey = getAdminKey();
  if (adminKey) {
    headers.set('X-Admin-Key', adminKey);
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
    let msg: string;
    const detail = data.detail;
    if (typeof detail === 'string') {
      msg = detail;
    } else if (Array.isArray(detail)) {
      msg = detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
    } else if (detail) {
      msg = JSON.stringify(detail);
    } else {
      msg = `请求失败 (${response.status})`;
    }
    throw new Error(msg);
  }

  return data as T;
}
