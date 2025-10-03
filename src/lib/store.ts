// src/lib/store.ts
import { openDB } from 'idb';
import { Asset } from '../types/asset';

const DB_NAME = 'cifra-inventory';
const STORE = 'assets';

async function db(){
  return openDB(DB_NAME, 1, {
    upgrade(d){ d.createObjectStore(STORE, { keyPath:'id' }); }
  });
}

export async function saveMany(items: (Asset & any)[]){
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  for (const it of items) await tx.store.put(it);
  await tx.done;
}

export async function allAssets(): Promise<(Asset & any)[]>{
  const d = await db();
  return await d.getAll(STORE) as any[];
}

export async function clearAll(){
  const d = await db();
  await d.clear(STORE);
}

export async function findByInv(inv: string): Promise<(Asset & any)|null>{
  const d = await db();
  const tx = d.transaction(STORE);
  // линейный обход — быстро для сотен/тысяч позиций; при необходимости можно завести индекс
  for await (const cur of tx.store) {
    if (cur.value.inv === inv) return cur.value as any;
  }
  return null;
}
