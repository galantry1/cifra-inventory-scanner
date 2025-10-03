import React, { useEffect, useMemo, useRef, useState } from 'react';
import Scanner from './components/Scanner';
import XlsImport from './components/XlsImport';
import { Asset } from './types/asset';
import { clearAll, saveMany } from './lib/store';
import { importItems, fetchItems } from './lib/api';
import { connectRT } from './lib/realtime';

function useQueryParam(key: string, def = '') {
  const v = new URLSearchParams(location.search).get(key);
  return v || def;
}

export default function InventoryScannerApp() {
  const sid = useQueryParam('s', 'cifra');           // общий ID сессии
  const userIdRef = useRef(crypto.randomUUID());     // локальный пользователь
  const socketRef = useRef<any>(null);               // <— держим постоянный сокет

  const [list, setList] = useState<(Asset & any)[]>([]);
  const [camOn, setCamOn] = useState(false);
  const [msg, setMsg] = useState('');

  // realtime socket
  useEffect(() => {
    const socket = connectRT(sid, userIdRef.current);
    socketRef.current = socket;

    socket.on('state', ({ items }) => setList(items));
    socket.on('itemUpdated', (it: any) => {
      setList(prev => {
        const m = new Map(prev.map(x => [x.inv, x]));
        m.set(it.inv, it);
        return [...m.values()];
      });
    });

    return () => socket.disconnect();
  }, [sid]);

  // initial fetch (если сервер уже держит состояние)
  useEffect(() => {
    (async () => {
      const r = await fetchItems(sid);
      if (r?.ok) setList(r.items);
    })();
  }, [sid]);

  const stats = useMemo(() => {
    const total = list.length;
    const found = list.filter(i => i.scannedAt).length;
    const duplicates = list.reduce((n,i)=>n+(i.duplicateCount||0),0);
    return { total, found, left: total - found, duplicates };
  }, [list]);

  async function handleImport(rows: Asset[]) {
    await saveMany(rows);         // оффлайн копия
    await importItems(sid, rows); // общая база (разошлётся всем в сессии)
    setMsg(`Импорт: ${rows.length}`);
    setTimeout(()=>setMsg(''), 1000);
  }

  async function onScan(text: string) {
    const inv = text.trim().replace(/^0+(\d)/, '$1');

    // мгновенный локальный апдейт
    setList(prev => {
      const m = new Map(prev.map(x => [x.inv, x]));
      const it = m.get(inv);
      if (!it) return prev;
      const next = { ...it };
      if (next.scannedAt) next.duplicateCount = (next.duplicateCount || 0) + 1;
      else next.scannedAt = new Date().toISOString();
      next.lastUser = userIdRef.current;
      m.set(inv, next);
      return [...m.values()];
    });

    // эмитим через постоянный сокет (фикс)
    socketRef.current?.emit('scan', { sid, userId: userIdRef.current, inv });
  }

  async function onClearLocal() {
    await clearAll();
    setMsg('Локальная база очищена');
    setTimeout(()=>setMsg(''), 800);
  }

  return (
    <div className="min-h-screen pb-24 max-w-[480px] mx-auto">
      {/* top bar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-green-100 px-3 pt-[env(safe-area-inset-top)]">
        <div className="py-2 flex items-center gap-2">
          <div className="text-base font-semibold">Инвентаризация</div>
          <div className="ml-auto text-xs text-gray-500">Сессия: <b>{sid}</b></div>
        </div>
      </div>

      {msg && <div className="m-3 p-2 rounded-xl bg-green-50 border border-green-200 text-sm">{msg}</div>}

      {/* counters */}
      <div className="grid grid-cols-4 gap-2 p-3">
        <Card t="Всего" v={stats.total} />
        <Card t="Найдено" v={stats.found} ok />
        <Card t="Дубликаты" v={stats.duplicates} warn />
        <Card t="Осталось" v={stats.left} />
      </div>

      {/* import */}
      <div className="card m-3">
        <div className="font-medium mb-2">Импорт</div>
        <XlsImport onAssets={handleImport}/>
        <div className="mt-2 flex gap-2">
          <button className="btnSecondary" onClick={onClearLocal}>Очистить локально</button>
        </div>
      </div>

      {/* scan */}
      <div className="card m-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Сканирование</div>
          <span className="badge">{camOn ? 'камера вкл' : 'камера выкл'}</span>
        </div>
        <button className="btn" onClick={()=>setCamOn(v=>!v)}>{camOn ? 'Стоп' : 'Включить'}</button>
        {camOn && <Scanner onResult={onScan} />}
      </div>

      {/* list */}
      <div className="card m-3">
        <div className="font-medium mb-2">Список ({list.length})</div>
        <div className="max-h-[55vh] overflow-auto border rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-green-50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">Наименование</th>
                <th className="text-left px-2 py-1">Инв. №</th>
                <th className="text-left px-2 py-1">Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map(it=>{
                const scanned = it.scannedAt;
                const d = it.duplicateCount||0;
                const status = scanned ? (d?`найдено (+${d})`:'найдено') : '—';
                return (
                  <tr key={it.inv} className={scanned?'bg-green-50':''}>
                    <td className="px-2 py-1">{it.name}</td>
                    <td className="px-2 py-1 font-mono">{it.inv}</td>
                    <td className="px-2 py-1">
                      <span className={'badge ' + (scanned?'bg-green-200 text-green-900':'')}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="h-10" />
    </div>
  );
}

function Card({ t, v, ok, warn }:{t:string; v:number; ok?:boolean; warn?:boolean;}) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${ok?'border-green-2 00 bg-green-50/60': warn?'border-amber-200 bg-amber-50/60':'border-green-100 bg-green-50/40'}`}>
      <div className="text-[10px] text-gray-500">{t}</div>
      <div className={`text-2xl font-semibold ${ok?'text-green-700': warn?'text-amber-700':''}`}>{v}</div>
    </div>
  );
}
