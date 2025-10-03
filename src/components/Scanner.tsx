// src/components/Scanner.tsx
import React from 'react';
import { ZXWorker } from '../workers/zx-worker';

const SUPPORTS_BARCODE = typeof window !== 'undefined' && 'BarcodeDetector' in window;
const BARCODE_FORMATS = ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','codabar'] as const;

export default function Scanner({ onResult, singleShot=false, onError }:{
  onResult:(text:string)=>void;
  singleShot?: boolean;
  onError?: (e:any)=>void;
}){
  const videoRef = React.useRef<HTMLVideoElement|null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement|null>(null);
  const [stream, setStream] = React.useState<MediaStream|null>(null);
  const [torch, setTorch] = React.useState(false);
  const [running, setRunning] = React.useState(true);
  const lastTextRef = React.useRef<string>('');   // анти-дубли
  const lastTsRef = React.useRef<number>(0);
  const workerRef = React.useRef<ZXWorker|null>(null);
  const rAFRef = React.useRef<number|undefined>(undefined);

  React.useEffect(()=>{ init(); return cleanup; },[]);

  async function init(){
    try{
      const constraints: MediaStreamConstraints = {
        video: { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}, focusMode:'continuous' as any },
        audio: false
      };
      const st = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(st);
      if (videoRef.current){ videoRef.current.srcObject = st; await videoRef.current.play(); }
      if (!SUPPORTS_BARCODE){ workerRef.current = new ZXWorker(); await workerRef.current.init(); }
      setRunning(true);
      tick();
    }catch(e){ onError?.(e); }
  }

  function cleanup(){
    setRunning(false);
    if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
    stream?.getTracks().forEach(t=>t.stop());
    workerRef.current?.terminate();
  }

  function toggleTorch(){
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    const cap = (track as any).getCapabilities?.();
    if (cap?.torch){
      setTorch(t => { (track as any).applyConstraints?.({ advanced:[{ torch:!t }] }); return !t; });
    }
  }

  async function decodeFrame(bitmap: ImageBitmap): Promise<string|null>{
    if (SUPPORTS_BARCODE){
      // @ts-ignore
      const det = new window.BarcodeDetector({ formats: BARCODE_FORMATS as any });
      const res = await det.detect(bitmap);
      return res?.[0]?.rawValue || null;
    } else {
      return await workerRef.current!.decode(bitmap);
    }
  }

  function tick(){
    if (!running || !videoRef.current) return;
    const v = videoRef.current;
    const draw = async () => {
      try{
        const w = 320;
        const h = Math.round(v.videoHeight * (w / v.videoWidth || 1));
        const cnv = canvasRef.current!;
        cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext('2d', { willReadFrequently:true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const blob = await new Promise<Blob|null>(r => cnv.toBlob(b => r(b), 'image/jpeg', 0.8));
        if (blob){
          const bmp = await createImageBitmap(blob);
          const txt = await decodeFrame(bmp);
          if (txt){
            const now = performance.now();
            if (txt !== lastTextRef.current || (now - lastTsRef.current) > 2000){
              lastTextRef.current = txt;
              lastTsRef.current = now;
              onResult(txt.trim());
              if (singleShot) { setRunning(false); return; }
            }
          }
        }
      }catch(e){ onError?.(e); }
      finally{
        // @ts-ignore
        if ('requestVideoFrameCallback' in v){ v.requestVideoFrameCallback(() => tick()); }
        else { rAFRef.current = requestAnimationFrame(tick); }
      }
    };
    draw();
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
