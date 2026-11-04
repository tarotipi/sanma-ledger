import { calcBalances, type Balance } from "../shared/mahjong";
import type { GroupState, Member, Session } from "../shared/types";
import { fitSize } from "../shared/yakuman";
import { liveGames } from "./store";

export function sessionOf(state: GroupState, sid: string): Session | undefined {
  return state.sessions.find((s) => s.id === sid);
}

export function sessionBalances(state: GroupState, sid: string): Record<string, Balance> {
  const s = sessionOf(state, sid);
  return calcBalances({
    games: liveGames(state, sid),
    chips: state.chips.filter((c) => c.sessionId === sid && !c.deletedAt),
    adjustments: state.adjustments.filter((a) => a.sessionId === sid && !a.deletedAt),
    chipYen: s?.chipYen ?? 100,
    chipEvents: state.chipEvents.filter((e) => e.sessionId === sid && !e.deletedAt),
  });
}

/** そのセッションに関わった人（半荘・チップ・調整・精算のどれかに登場） */
export function participants(state: GroupState, sid: string): Member[] {
  const ids = new Set<string>();
  liveGames(state, sid).forEach((g) => g.scores.forEach((s) => ids.add(s.memberId)));
  state.chips.filter((c) => c.sessionId === sid && !c.deletedAt).forEach((c) => c.lines.forEach((l) => ids.add(l.memberId)));
  state.adjustments
    .filter((a) => a.sessionId === sid && !a.deletedAt)
    .forEach((a) => a.lines.forEach((l) => ids.add(l.memberId)));
  state.settlements.filter((x) => x.sessionId === sid && !x.deletedAt).forEach((x) => ids.add(x.memberId));
  state.chipEvents.filter((x) => x.sessionId === sid && !x.deletedAt).forEach((x) => ids.add(x.memberId));
  return state.members.filter((m) => ids.has(m.id));
}

export type SettledImpact = { memberId: string; recorded: number; next: number };

/** W-04：精算済みの人の金額が変わるかどうか */
export function settledImpact(before: GroupState, after: GroupState, sid: string): SettledImpact[] {
  const nextB = sessionBalances(after, sid);
  return before.settlements
    .filter((x) => x.sessionId === sid && !x.deletedAt)
    .map((x) => ({ memberId: x.memberId, recorded: x.yen, next: nextB[x.memberId]?.total ?? 0 }))
    .filter((x) => x.recorded !== x.next);
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PHOTO_SIDE = 1600;
const THUMB_SIDE = 320;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("画像を変換できませんでした。端末のメモリが足りない可能性があります。"))), "image/jpeg", quality),
  );
}

function drawTo(src: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を変換できませんでした。");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  return canvas;
}

// iOS は canvas に使えるメモリが少ないので、使い終わったらすぐ解放する
function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** <img> で読む。写真の向き（EXIF）を確実に反映するため */
async function decodeFile(file: File): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const release = () => {
    img.src = "";
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error());
      img.src = url;
    });
  } catch {
    release();
    throw new Error(`この写真は読み込めませんでした（形式：${file.type || "不明"}）。`);
  }
  return { img, release };
}

// 同時に複数枚を展開するとメモリが足りなくなるので、1枚ずつ処理する
let imageQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const next = imageQueue.then(fn, fn);
  imageQueue = next.catch(() => undefined);
  return next;
}

/** 役満の写真：本体（長辺1600px）とサムネイル（長辺320px）を作る */
export function prepareImage(file: File): Promise<{ full: Blob; thumb: Blob; width: number; height: number }> {
  return oneAtATime(async () => {
    const { img, release } = await decodeFile(file);
    try {
      const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, PHOTO_SIDE);
      const canvas = drawTo(img, width, height);
      try {
        const full = await toJpeg(canvas, 0.8);
        const t = fitSize(width, height, THUMB_SIDE);
        // サムネイルは縮小済みの本体から作る（元の写真を2回展開しない）
        const small = drawTo(canvas, t.width, t.height);
        try {
          return { full, thumb: await toJpeg(small, 0.7), width, height };
        } finally {
          freeCanvas(small);
        }
      } finally {
        freeCanvas(canvas);
      }
    } finally {
      release();
    }
  });
}

/** 背景の写真：全画面に薄く表示するだけなので、軽くしておく */
export function prepareBackground(file: File): Promise<Blob> {
  return oneAtATime(async () => {
    const { img, release } = await decodeFile(file);
    try {
      const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, 1280);
      const canvas = drawTo(img, width, height);
      try {
        return await toJpeg(canvas, 0.7);
      } finally {
        freeCanvas(canvas);
      }
    } finally {
      release();
    }
  });
}
