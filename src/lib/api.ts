export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function toJson<T = any>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export async function importItems(sid: string, items: any[]) {
  const r = await fetch(`${API_URL}/api/session/${encodeURIComponent(sid)}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return toJson<{ ok: boolean; count: number }>(r);
}

export async function fetchItems(sid: string) {
  const r = await fetch(`${API_URL}/api/session/${encodeURIComponent(sid)}/items`);
  return toJson<{ ok: boolean; items: any[] }>(r);
}

export async function clearSession(sid: string) {
  const r = await fetch(`${API_URL}/api/session/${encodeURIComponent(sid)}/clear`, { method: 'DELETE' });
  return toJson<{ ok: boolean }>(r);
}
