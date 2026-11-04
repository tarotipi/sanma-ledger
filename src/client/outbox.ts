// 送信待ちの役満と写真。送信が終わるまで端末（IndexedDB）に残す。
// capture で撮った写真はアルバムに残らないことがあるので、送信に失敗しても失わないようにするため。

import { newId } from "./api";
import { prepareImage } from "./logic";

type Base = { id: string; gid: string; sessionId: string; createdAt: string; error: string | null; dead: boolean };

export type OutboxYakuman = Base & { kind: "yakuman"; gameId: string | null; memberId: string; name: string };
export type OutboxPhoto = Base & {
  kind: "photo";
  yakumanId: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** 入力の途中。保存が確定するまで送らない */
  hold: boolean;
};
export type OutboxItem = OutboxYakuman | OutboxPhoto;

const DB = "sanma-outbox";
const STORE = "items";

// IndexedDB が使えない環境では、開いているあいだだけメモリに残す
const memory = new Map<string, OutboxItem>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error("IndexedDB が使えません"));
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB の読み書きに失敗しました"));
      }),
  );
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function listOutbox(gid: string): Promise<OutboxItem[]> {
  let stored: OutboxItem[] = [];
  try {
    stored = await run<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  } catch {
    /* メモリの分だけ返す */
  }
  return [...stored, ...memory.values()].filter((x) => x.gid === gid).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function put(item: OutboxItem): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(item));
    memory.delete(item.id);
  } catch {
    memory.set(item.id, item);
  }
}

async function remove(id: string): Promise<void> {
  memory.delete(id);
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    /* メモリから消せていればよい */
  }
}

/** 写真を縮小して送信待ちに入れる。hold のあいだは送らない */
export async function addPhoto(file: File, p: { gid: string; sessionId: string; yakumanId: string; hold: boolean }): Promise<OutboxPhoto> {
  const img = await prepareImage(file);
  const item: OutboxPhoto = {
    kind: "photo",
    id: newId(),
    gid: p.gid,
    sessionId: p.sessionId,
    yakumanId: p.yakumanId,
    createdAt: new Date().toISOString(),
    error: null,
    dead: false,
    hold: p.hold,
    ...img,
  };
  await put(item);
  notify();
  return item;
}

export async function addYakuman(p: { id: string; gid: string; sessionId: string; gameId: string | null; memberId: string; name: string }): Promise<void> {
  await put({ ...p, kind: "yakuman", createdAt: new Date().toISOString(), error: null, dead: false });
  notify();
}

/** 入力が確定した役満の写真を、送信してよい状態にする */
export async function releaseHeld(gid: string, yakumanIds: readonly string[]): Promise<void> {
  const items = await listOutbox(gid);
  await Promise.all(items.filter((x) => x.kind === "photo" && x.hold && yakumanIds.includes(x.yakumanId)).map((x) => put({ ...x, hold: false } as OutboxPhoto)));
  notify();
}

/** 取り消された入力の写真を捨てる */
export async function discardHeld(gid: string, yakumanIds: readonly string[]): Promise<void> {
  const items = await listOutbox(gid);
  await Promise.all(items.filter((x) => x.kind === "photo" && x.hold && yakumanIds.includes(x.yakumanId)).map((x) => remove(x.id)));
  notify();
}

export async function discardItem(id: string): Promise<void> {
  await remove(id);
  notify();
}

/** 止まっている項目を、もう一度送る対象に戻す */
export async function reviveAll(gid: string): Promise<void> {
  const items = await listOutbox(gid);
  await Promise.all(items.filter((x) => x.dead).map((x) => put({ ...x, dead: false, error: null })));
  notify();
}

type Sender = {
  /** 役満を送る */
  yakuman: (x: OutboxYakuman) => Promise<void>;
  /** 写真を送る */
  photo: (x: OutboxPhoto) => Promise<void>;
  /** 失敗の扱いを決める。true なら自動で送り直す */
  retryable: (e: unknown) => boolean;
  /** 失敗をサーバーのログへ残す */
  report: (x: OutboxItem, e: unknown) => void;
};

const flushing = new Set<string>();

/** 送信待ちを順に送る。1枚ずつ処理し、1件失敗しても残りは続ける。送れた件数を返す */
export async function flushOutbox(gid: string, send: Sender): Promise<number> {
  if (flushing.has(gid)) return 0;
  flushing.add(gid);
  let sent = 0;
  try {
    // 送っている間に増えた分も続けて送る（1回の処理で同じ項目は1度だけ試す）
    const tried = new Set<string>();
    for (;;) {
      const items = (await listOutbox(gid)).filter((x) => !x.dead && !(x.kind === "photo" && x.hold) && !tried.has(x.id));
      // 写真は役満の後に送る
      const item = items.find((x) => x.kind === "yakuman") ?? items[0];
      if (!item) break;
      tried.add(item.id);
      try {
        if (item.kind === "yakuman") await send.yakuman(item);
        else await send.photo(item);
        await remove(item.id);
        sent++;
      } catch (e) {
        send.report(item, e);
        await put({ ...item, error: e instanceof Error ? e.message : "送信できませんでした。", dead: !send.retryable(e) });
      }
      notify();
    }
  } finally {
    flushing.delete(gid);
  }
  return sent;
}
