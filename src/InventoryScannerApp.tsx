
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { BrowserMultiFormatReader } from '@zxing/browser';

type Item = {
  name: string;
  code: string;
  scanned?: boolean;
  duplicateCount?: number;
  scannedAt?: string;
};

type ScanEngine = 'barcode-detector' | 'zxing';

const GREEN = '#22c55e';


function useBarcode() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [engine, setEngine] = useState<ScanEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  // удерживаем «текущий» код и время последнего успешного распознавания этого кода
  const holdCodeRef = useRef<string | null>(null);
  const lastSeenRef = useRef<number>(0);
  const CLEAR_AFTER_MS = 700; // спустя ~0.7с «потери» кода разрешаем повторное сканирование

  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  async function start(onCode: (text: string) => void) {
    if (active) return;
    setActive(true);
    const hasBD = 'BarcodeDetector' in (window as any);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (hasBD) {
        setEngine('barcode-detector');
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector({ formats: ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e'] });
        let stopped = false;
        const tick = async () => {
          if (stopped) return;
          try {
            if (!videoRef.current) return;
            const track = stream.getVideoTracks()[0];
            const cap = new ImageCapture(track);
            const bitmap = await cap.grabFrame();
            const barcodes = await detector.detect(bitmap);
            const now = Date.now();

            if (barcodes.length === 0) {
              // нет кода в кадре — отсчитываем таймер «потери»
              if (holdCodeRef.current && now - lastSeenRef.current > CLEAR_AFTER_MS) {
                holdCodeRef.current = null;
              }
            } else {
              // берём первый найденный (обычно один в кадре)
              const text = String(barcodes[0].rawValue || '').trim();
              if (!holdCodeRef.current) {
                holdCodeRef.current = text;
                lastSeenRef.current = now;
                onCode(text);
              } else if (text === holdCodeRef.current) {
                // тот же код — просто обновляем «видели»
                lastSeenRef.current = now;
              } else {
                // другой код — сразу разрешаем и «захватываем» его
                holdCodeRef.current = text;
                lastSeenRef.current = now;
                onCode(text);
              }
            }
          } catch {}
          requestAnimationFrame(tick);
        };
        tick();
        return () => { stopped = true; };
      } else {
        setEngine('zxing');
        const reader = new BrowserMultiFormatReader();
        zxingReaderRef.current = reader;
        const previewElem = videoRef.current!;
        await reader.decodeFromVideoElement(previewElem, (result, err) => {
          const now = Date.now();
          if (result) {
            const text = result.getText().trim();
            if (!holdCodeRef.current) {
              holdCodeRef.current = text;
              lastSeenRef.current = now;
              onCode(text);
            } else if (text === holdCodeRef.current) {
              lastSeenRef.current = now;
            } else {
              holdCodeRef.current = text;
              lastSeenRef.current = now;
              onCode(text);
            }
          } else {
            // нет результата (ошибка/ничего не найдено) — возможно код ушёл из кадра
            if (holdCodeRef.current && now - lastSeenRef.current > CLEAR_AFTER_MS) {
              holdCodeRef.current = null;
            }
          }
        });
      }
    } catch (err) {
      setActive(false);
      throw err;
    }
  }

  function stop() {
    setActive(false);
    if (zxingReaderRef.current) {
      try { zxingReaderRef.current.reset(); } catch {}
      zxingReaderRef.current = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      (videoRef.current as any).srcObject = null;
    }
    // сбрасываем удерживаемый код
    holdCodeRef.current = null;
  }

  return { videoRef, start, stop, active, engine };
}
export default function InventoryScannerApp() {
  const [items, setItems] = useState<Item[]>([]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const { videoRef, start, stop, active, engine } = useBarcode();

  const stats = useMemo(() => {
    const total = items.length;
    const found = items.filter(i => i.scanned).length;
    const duplicates = items.reduce((acc, i) => acc + (i.duplicateCount || 0), 0);
    const left = total - found;
    return { total, found, duplicates, left };
  }, [items]);

  function parseCsv(text: string) {
    const res = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    if (res.errors && res.errors.length) {
      throw new Error('Ошибка парсинга CSV: ' + res.errors[0].message);
    }
    const out: Item[] = [];
    for (const row of res.data as any[]) {
      const name = String(row.name ?? row['Наименование'] ?? '').trim();
      const code = String(row.code ?? row['Инвентаризационный код'] ?? '').trim();
      if (!name || !code) continue;
      out.push({ name, code, scanned: false, duplicateCount: 0 });
    }
    if (!out.length) throw new Error('В CSV нет валидных строк или заголовков. Нужны столбцы: name,code');
    return out;
  }

  const onFile = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const list = parseCsv(text);
        setItems(list);
        setInfo(`Загружено элементов: ${list.length}`);
      } catch (e: any) {
        setError(e.message || String(e));
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handlePaste = () => {
    setError(null);
    try {
      const list = parseCsv(pasteText);
      setItems(list);
      setShowPaste(false);
      setPasteText('');
      setInfo(`Загружено элементов: ${list.length}`);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  };

  const onScanCode = (raw: string) => {
    const text = raw.trim();
    // иногда QR несёт цифры с ведущими нулями. Нормализуем — убираем ведущие нули.
    const normalized = text.replace(/^0+(\d)/, '$1');
    setItems(prev => {
      const idx = prev.findIndex(i => i.code === text || i.code === normalized);
      if (idx === -1) {
        setScanError(`Код «${text}» не найден в списке`);
        setTimeout(() => setScanError(null), 2000);
        return prev;
      }
      const next = [...prev];
      const item = { ...next[idx] };
      if (item.scanned) {
        item.duplicateCount = (item.duplicateCount || 0) + 1;
      } else {
        item.scanned = true;
        item.scannedAt = new Date().toISOString();
      }
      next[idx] = item;
      return next;
    });
  };

  const exportCsv = () => {
    const rows = items.map(i => ({
      name: i.name,
      code: i.code,
      scanned: i.scanned ? 'yes' : 'no',
      duplicateCount: i.duplicateCount || 0,
      scannedAt: i.scannedAt || ''
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, 'inventory_result.csv');
  };

  const resetMarks = () => {
    setItems(prev => prev.map(i => ({ ...i, scanned: false, duplicateCount: 0, scannedAt: '' })));
    setInfo('Отметки сброшены');
    setTimeout(() => setInfo(null), 1500);
  };

  const toggleCam = async () => {
    if (active) {
      stop();
      return;
    }
    try {
      await start(onScanCode);
      setScanError(null);
    } catch (e: any) {
      setScanError(e.message || 'Не удалось открыть камеру');
    }
  };

  return (
    <div className="min-h-screen pb-24">
      <header className="header">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/logo.jpg" alt="Logo" className="h-7 w-auto rounded-md border border-gray-200" />
          <div className="text-lg font-semibold">Инвентаризация — сканер штрихкодов</div>
          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={exportCsv}>Экспорт CSV</button>
            <button className="btnSecondary" onClick={resetMarks}>Сброс</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 mt-4 space-y-4">
        {info && <div className="card">{info}</div>}
        {error && <div className="card bg-red-50 border-red-200 text-red-800">{error}</div>}
        {scanError && <div className="card bg-yellow-50 border-yellow-200 text-yellow-900">{scanError}</div>}

        <section className="grid grid-cols-4 gap-2">
          <div className="card text-center">
            <div className="text-xs text-gray-500">Всего</div>
            <div className="text-2xl font-semibold">{stats.total}</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Найдено</div>
            <div className="text-2xl font-semibold text-green-700">{stats.found}</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Дубликаты</div>
            <div className="text-2xl font-semibold text-amber-700">{stats.duplicates}</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Осталось</div>
            <div className="text-2xl font-semibold">{stats.left}</div>
          </div>
        </section>

        <section className="card space-y-3">
          <div className="font-medium">1) Загрузите список имущества</div>
          <div className="text-sm text-gray-600">CSV с заголовками <b>name,code</b> или русскими «Наименование,Инвентаризационный код»</div>
          <input type="file" accept=".csv,text/csv" onChange={(e)=>{ const f=e.target.files?.[0]; if(f) onFile(f); }} />
          <details>
            <summary className="cursor-pointer text-sm text-gray-700">Вставить из буфера (CSV)</summary>
            <div className="mt-2 space-y-2">
              <textarea rows={6} placeholder="name,code\nСтул офисный,0379" value={pasteText} onChange={e=>setPasteText(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn" onClick={handlePaste}>Загрузить из текста</button>
                <button className="btnSecondary" onClick={()=>setPasteText('')}>Очистить</button>
              </div>
            </div>
          </details>
        </section>

        <section className="card space-y-3">
          <div className="flex items-center gap-3">
            <div className="font-medium">2) Сканирование</div>
            <span className="badge">{active ? `Камера: ВКЛ (${engine ?? '—'})` : 'Камера: выкл'}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={toggleCam}>{active ? 'Остановить камеру' : 'Включить камеру'}</button>
          </div>
          <video ref={videoRef} className="w-full rounded-2xl border border-gray-200" muted playsInline></video>
          <div className="text-xs text-gray-600">Пример: QR/штрихкод со значением <b>0379</b> должен отметить соответствующую запись.</div>
        </section>

        <section className="card">
          <div className="font-medium mb-2">3) Список ({items.length})</div>
          <div className="max-h-72 overflow-auto border rounded-xl">
            <table>
              <thead className="bg-green-50 sticky top-0">
                <tr>
                  <th className="text-left">Наименование</th>
                  <th className="text-left">Код</th>
                  <th className="text-left">Статус</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const status = it.scanned ? (it.duplicateCount ? `найдено (+${it.duplicateCount})` : 'найдено') : 'не найдено';
                  return (
                    <tr key={idx} className={it.scanned ? 'bg-green-50' : ''}>
                      <td>{it.name}</td>
                      <td className="font-mono">{it.code}</td>
                      <td>
                        <span className={'badge ' + (it.scanned ? 'bg-green-200 text-green-900' : '')}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-10 text-center text-xs text-gray-500">
        © Inventory Scanner • Работает офлайн, импорт/экспорт CSV, камера через getUserMedia / BarcodeDetector
      </footer>
    </div>
  );
}
