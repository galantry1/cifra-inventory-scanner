export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function importItems(sid: string, items: any[]) {
  const r = await fetch(`${API_URL}/api/session/${encodeURIComponent(sid)}/import`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ items }),
  });
  return r.json();
}

export async function fetchItems(sid: string) {
  const r = await fetch(`${API_URL}/api/session/${encodeURIComponent(sid)}/items`);
  return r.json();
}
