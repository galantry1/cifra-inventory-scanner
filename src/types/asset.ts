// src/types/asset.ts
export type Asset = {
  id: string;
  inv: string;       // инвентарный номер (ключ для сопоставления со сканом)
  name: string;      // наименование
  serial?: string;
  location?: string;
  resp?: string;
  note?: string;
  // служебные поля, которые мы добавляем динамически:
  scannedAt?: string;
  duplicateCount?: number;
};
