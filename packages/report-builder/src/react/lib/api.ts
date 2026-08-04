/**
 * Same-origin JSON fetch for the reports surface — self-contained so the
 * package plugs into any SPA without a host fetch layer (the host still owns
 * cookies/session; requests ride the browser's credentials).
 */
export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}
