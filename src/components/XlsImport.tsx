// src/components/XlsImport.tsx
import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Asset } from '../types/asset';

function norm(s: any) {
  return String(s ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeaderPair(a: any, b: any) {
  const A = norm(a).toLowerCase();
  const B = norm(b).toLowerCase();
  const nameHints = ['наименование', 'предмет', 'название', 'name', 'item'];
  const codeHints = ['шк', 'код', 'инв', 'инв номер', 'инвентарн', 'inventory', 'inv'];
  return nameHints.some(h => A.includes(h)) && codeHints.some(h => B.includes(h));
}

function cleanName(x: string) {
  // у тебя в данных часто хвосты типа ", , ,"
  return x.replace(/(?:\s*,\s*){1,}$/g, '').replace(/\s{2,}/g, ' ').trim();
}

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
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        // Берём ПЕРВЫЙ лист и читаем как массив массивов
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true });

        if (!rows.length) {
          setCount(0);
          setWarn('Файл пустой или лист без строк.');
          onAssets([]);
          return;
        }

        // Фильтруем строки, где в первых двух колонках есть что-то
        let filtered = rows.filter(r => {
          const c0 = r?.[0]; const c1 = r?.[1];
          return (c0 != null && String(c0).trim() !== '') || (c1 != null && String(c1).trim() !== '');
        });

        if (!filtered.length) {
          setCount(0);
          setWarn('Не нашёл данных в первых двух столбцах.');
          onAssets([]);
          return;
        }

        // Если первая строка — заголовки «Наименование / ШК», то пропускаем её
        if (filtered.length && isHeaderPair(filtered[0]?.[0], filtered[0]?.[1])) {
          filtered = filtered.slice(1);
        }

        // Преобразуем в Asset[]: [0] -> name, [1] -> inv
        const out: Asset[] = [];
        for (const r of filtered) {
          const rawName = norm(r?.[0]);
          const rawInv = norm(r?.[1]);
          if (!rawName && !rawInv) continue;
          if (!rawName || !rawInv) continue; // нужны обе колонки
          out.push({
            id: crypto.randomUUID(),
            name: cleanName(rawName),
            inv: rawInv,      // тут именно ШК/инв.номер
          });
        }

        setCount(out.length);
        if (!out.length) setWarn('Строки распознаны, но пустые значения в парах (Наименование/ШК).');
        onAssets(out);
      } catch (err: any) {
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
        <div className="text-sm text-neutral-500">Формат: 2 колонки — Наименование | ШК</div>
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
