import React from 'react';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/browser';

const HAS_BD = typeof window !== 'undefined' && 'BarcodeDetector' in window;
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
const HAS_CREATE_IMAGE_BITMAP = typeof window !== 'undefined' && 'createImageBitmap' in window;

const BARCODE_FORMATS = [
  'qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','codabar'
] as const;

export default function Scanner({
  onResult, singleShot = false, onError
}: { onResult: (text:string)=>void; singleShot?: boolean; onError?: (e:any)=>void; }) {

  const videoRef = React.useRef<HTMLVideoElement|null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement|null>(null);
  const [stream, setStream] = React.useState<MediaStream|null>(null);
  const [torch, setTorch] = React.useState(false);
  const runningRef = React.useRef(true);
  const lastTextRef = React.useRef('');   // анти-дубли
  const lastTsRef = React.useRef(0);
  const rAFRef = React.useRef<number>();
  const zxingRef = React.useRef<BrowserMultiFormatReader|null>(null);

  React.useEffect(() => { init(); return cleanup; }, []);

  async function init() {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const st = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(st);
      const v = videoRef.current!;
      v.srcObject = st;
      await v.play();

      runningRef.current = true;

      // Путь 1: нативный BarcodeDetector — быстрый
      if (HAS_BD) {
        tickBD();
        return;
      }

      // Путь 2: надёжный мобильный фоллбек — ZXing по <video>
      // (для iOS/старых браузеров, где нет createImageBitmap)
      if (IS_IOS || !HAS_CREATE_IMAGE_BITMAP) {
        const reader = new BrowserMultiFormatReader();
        zxingRef.current = reader;

        // подсказки форматов
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39
        ]);
        reader.setHints(hints);

        await reader.decodeFromVideoElement(v, (res, err) => {
          if (!runningRef.current) return;
          if (res?.getText) {
            deliver(res.getText());
            if (singleShot) stopZX(); // инициализируем остановку
          }
        });
        return;
      }

      // Путь 3: worker/канвас (для Android/десктопа)
      tickCanvasZX();
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

  function stopZX() {
    runningRef.current = false;
    if (zxingRef.current) { try { zxingRef.current.reset(); } catch {} zxingRef.current = null; }
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

  function deliver(txt: string) {
    const now = performance.now();
    const text = String(txt || '').trim();
    if (!text) return;
    if (text !== lastTextRef.current || (now - lastTsRef.current) > 2000) {
      lastTextRef.current = text;
      lastTsRef.current = now;
      onResult(text);
    }
  }

  /** ===== BarcodeDetector loop ===== */
  async function tickBD() {
    const v = videoRef.current!;
    // @ts-ignore
    const det = new window.BarcodeDetector({ formats: BARCODE_FORMATS as any });

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
        const w = 320;
        const h = Math.round(v.videoHeight * (w / v.videoWidth || 1));
        const cnv = canvasRef.current!;
        cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext('2d', { willReadFrequently:true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        // det.detect принимает ImageBitmap/Canvas, поэтому используем cnv
        const res = await det.detect(cnv as any);
        if (res && res[0]?.rawValue) deliver(res[0].rawValue);
      } catch {}
      loop();
    };
    loop();
  }

  /** ===== Canvas + ZXing (без worker) ===== */
  async function tickCanvasZX() {
    const v = videoRef.current!;
    const reader = new BrowserMultiFormatReader();
    zxingRef.current = reader;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39
    ]);
    reader.setHints(hints);

    const loop = async () => {
      if (!runningRef.current) return;
      try {
        const w = 320;
        const h = Math.round(v.videoHeight * (w / v.videoWidth || 1));
        const cnv = canvasRef.current!;
        cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext('2d', { willReadFrequently:true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const res = await reader.decodeFromCanvas(cnv);
        if (res?.getText) {
          deliver(res.getText());
          if (singleShot) return stopZX();
        }
      } catch {
        // ничего — просто продолжаем
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
