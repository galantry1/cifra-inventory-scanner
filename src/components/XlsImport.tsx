import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Asset } from '../types/asset';

const norm = (s:any) => String(s ?? '').replace(/\r?\n+/g,' ').replace(/\s+/g,' ').trim();
const cleanName = (x:string) => x.replace(/(?:\s*,\s*){1,}$/g,'').replace(/\s{2,}/g,' ').trim();
const isHeaderRow = (a:any,b:any,c:any) => {
  const A = norm(a).toLowerCase(), B = norm(b).toLowerCase(), C = norm(c).toLowerCase();
  return A.includes('наимен') && (B.includes('шк') || B.includes('инв')) && (C.includes('распол') || C.includes('кабин'));
};
const fmtCab = (raw:string) => {
  const s = norm(raw).replace(/^каб(инет)?\.?\s*/i,'');
  return s ? `каб. ${s}` : '';
};

export default function XlsImport({ onAssets }:{ onAssets:(rows:Asset[])=>void }) {
  const [count, setCount] = useState(0);
  const [warn, setWarn] = useState('');
  const fileRef = useRef<HTMLInputElement|null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setWarn('');
    const f = e.target.files?.[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows:any[][] = XLSX.utils.sheet_to_json(ws, { header:1, blankrows:false, raw:true });
        let filtered = rows.filter(r => (r?.[0] ?? '') !== '' || (r?.[1] ?? '') !== '' || (r?.[2] ?? '') !== '');
        if (filtered.length && isHeaderRow(filtered[0][0], filtered[0][1], filtered[0][2])) filtered = filtered.slice(1);

        const out: Asset[] = [];
        for (const r of filtered) {
          const name = cleanName(norm(r?.[0]));
          const inv  = norm(r?.[1]);
          const loc  = fmtCab(norm(r?.[2] || ''));
          if (!name || !inv) continue;
          out.push({ id: crypto.randomUUID(), name, inv, location: loc || null } as Asset);
        }

        setCount(out.length);
        if (!out.length) setWarn('Не нашёл валидных строк.');
        onAssets(out);
      } catch (err:any) {
        setCount(0);
        setWarn('Ошибка чтения XLS: ' + (err?.message || String(err)));
        onAssets([]);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="font-medium">Импорт .XLS/.XLSX</div>
        <div className="text-sm text-neutral-500">Колонки: Наименование | ШК | Расположение</div>
        <div className="text-sm mt-1">Импортировано: <b>{count}</b></div>
        {warn && <div className="text-sm mt-1 text-amber-700">{warn}</div>}
      </div>
      <button className="btn" onClick={() => fileRef.current?.click()}>Выбрать файл</button>
      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
