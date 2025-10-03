import React from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

const HAS_BD = typeof window !== 'undefined' && 'BarcodeDetector' in window;
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
const HAS_CREATE_IMAGE_BITMAP = typeof window !== 'undefined' && 'createImageBitmap' in window;

// список форматов
const HINTS = (() => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.CODE_128,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_39
  ]);
  return hints;
})();

// спустя сколько «отсутствия» кода разрешать следующий такой же
const CLEAR_AFTER_MS = 900;

export default function Scanner({
  onResult, singleShot = false, onError
}: { onResult: (text:string)=>void; singleShot?: boolean; onError?: (e:any)=>void; }) {

  const videoRef = React.useRef<HTMLVideoElement|null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement|null>(null);
  const [stream, setStream] = React.useState<MediaStream|null>(null);
  const [torch, setTorch] = React.useState(false);
  const runningRef = React.useRef(true);
  const rAFRef = React.useRef<number>();

  // анти-дубли «захват»
  const holdCodeRef = React.useRef<string | null>(null);
  const lastSeenRef = React.useRef<number>(0);

  const zxingRef = React.useRef<BrowserMultiFormatReader|null>(null);

  React.useEffect(() => { init(); return cleanup; }, []);

  async function init() {
    try {
      const st = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      setStream(st);
      const v = videoRef.current!;
      v.srcObject = st;
      await v.play();

      runningRef.current = true;

      if (HAS_BD) {
        tickBD();
        return;
      }
      if (IS_IOS || !HAS_CREATE_IMAGE_BITMAP) {
        const reader = new BrowserMultiFormatReader();
        reader.setHints(HINTS);
        zxingRef.current = reader;
        await reader.decodeFromVideoElement(v, (res, err) => {
          if (!runningRef.current) return;
          if (res?.getText) maybeEmit(res.getText());
        });
        // параллельно следим за «пропажей» кода для сброса захвата
        idleWatcher();
        return;
      }
      tickCanvasZX();
      idleWatcher();
    } catch (e) {
      onError?.(e);
    }
  }

  function cleanup() {
    runningRef.current = false;
    if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
    if (zxingRef.current) { try { zxingRef.current.reset(); } catch {} zxingRef.current = null; }
    stream?.getTracks().forEach(t => t.stop());
  }

  function toggleTorch() {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    const caps = (track as any).getCapabilities?.();
    if (caps?.torch) {
      setTorch(t => {
        (track as any).applyConstraints?.({ advanced: [{ torch: !t }] });
        return !t;
      });
    }
  }

  // единая точка выдачи результата с анти-дублем
  function maybeEmit(txt: string) {
    const now = performance.now();
    const text = String(txt || '').trim();
    if (!text) return;

    if (holdCodeRef.current === null) {
      // кода не захвачено — захватываем и отдаём
      holdCodeRef.current = text;
      lastSeenRef.current = now;
      onResult(text);
      if (singleShot) runningRef.current = false;
    } else if (holdCodeRef.current === text) {
      // тот же код — просто обновляем «видели»
      lastSeenRef.current = now;
    } else {
      // другой код — сразу переключаем захват
      holdCodeRef.current = text;
      lastSeenRef.current = now;
      onResult(text);
    }
  }

  // если код пропал из кадра дольше CLEAR_AFTER_MS — сбрасываем захват
  function idleWatcher() {
    const loop = () => {
      if (!runningRef.current) return;
      const now = performance.now();
      if (holdCodeRef.current && now - lastSeenRef.current > CLEAR_AFTER_MS) {
        holdCodeRef.current = null;
      }
      rAFRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  /** ===== BarcodeDetector loop ===== */
  async function tickBD() {
    const v = videoRef.current!;
    // @ts-ignore
    const det = new window.BarcodeDetector({ formats: ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','codabar'] });

    const loop = async () => {
      if (!runningRef.current) return;
      try {
        // @ts-ignore
        if ('requestVideoFrameCallback' in v) {
          // @ts-ignore
          await new Promise<void>(r => v.requestVideoFrameCallback(() => r()));
        } else {
          await new Promise<void>(r => { rAFRef.current = requestAnimationFrame(() => r()); });
        }
        const cnv = canvasRef.current!;
        const w = 320;
        const h = Math.round(v.videoHeight * (w / v.videoWidth || 1));
        cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext('2d', { willReadFrequently:true })!;
        ctx.drawImage(v, 0, 0, w, h);

        const res = await det.detect(cnv as any);
        if (res && res[0]?.rawValue) maybeEmit(res[0].rawValue);
      } catch {}
      loop();
    };
    loop();
  }

  /** ===== Canvas + ZXing (без worker) ===== */
  async function tickCanvasZX() {
    const v = videoRef.current!;
    const reader = new BrowserMultiFormatReader();
    reader.setHints(HINTS);
    zxingRef.current = reader;

    const loop = async () => {
      if (!runningRef.current) return;
      try {
        const cnv = canvasRef.current!;
        const w = 320;
        const h = Math.round(v.videoHeight * (w / v.videoWidth || 1));
        cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext('2d', { willReadFrequently:true })!;
        ctx.drawImage(v, 0, 0, w, h);

        const res = await reader.decodeFromCanvas(cnv);
        if (res?.getText) maybeEmit(res.getText());
      } catch {
        // не нашли — это нормально, ждём следующий кадр
      } finally {
        // @ts-ignore
        if ('requestVideoFrameCallback' in v) {
          // @ts-ignore
          v.requestVideoFrameCallback(() => loop());
        } else {
          rAFRef.current = requestAnimationFrame(loop);
        }
      }
    };
    loop();
  }

  return (
    <div className="relative">
      <video ref={videoRef} className="w-full rounded-2xl border border-gray-200" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute bottom-3 right-3">
        <button className="px-3 py-1 rounded bg-black/50 text-white" onClick={toggleTorch}>
          {torch ? 'Фонарик Вкл' : 'Фонарик'}
        </button>
      </div>
    </div>
  );
}
