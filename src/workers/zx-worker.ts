// src/workers/zx-worker.ts
export class ZXWorker{
  private worker?: Worker;

  async init(){
    if (this.worker) return;
    const blob = new Blob([`
      self.importScripts('https://cdn.jsdelivr.net/npm/@zxing/browser@latest/umd/index.min.js');
      let reader = new self.ZXingBrowser.BrowserMultiFormatReader();
      const hints = new Map();
      hints.set(self.ZXingBrowser.DecodeHintType.TRY_HARDER, false);
      hints.set(self.ZXingBrowser.DecodeHintType.POSSIBLE_FORMATS, [
        self.ZXingBrowser.BarcodeFormat.QR_CODE,
        self.ZXingBrowser.BarcodeFormat.CODE_128,
        self.ZXingBrowser.BarcodeFormat.EAN_13,
        self.ZXingBrowser.BarcodeFormat.EAN_8,
        self.ZXingBrowser.BarcodeFormat.ITF,
        self.ZXingBrowser.BarcodeFormat.CODABAR,
      ]);
      reader.setHints(hints);
      self.onmessage = async (e)=> {
        const bitmap = e.data;
        try{
          const res = await reader.decodeFromImageBitmap(bitmap);
          self.postMessage({ ok:true, text: res?.text || null });
        }catch(err){
          self.postMessage({ ok:false });
        }
      };
    `], { type:'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
  }

  terminate(){ this.worker?.terminate(); }

  decode(bitmap: ImageBitmap): Promise<string|null>{
    return new Promise(res=>{
      if (!this.worker) return res(null);
      const onMsg = (e: MessageEvent) => {
        this.worker!.removeEventListener('message', onMsg);
        if (e.data?.ok && e.data.text) res(e.data.text); else res(null);
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.postMessage(bitmap, [bitmap as any]);
    });
  }
}
