import { calcBalances, type Balance } from "../shared/mahjong";
import type { GroupState, Member, Session } from "../shared/types";
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

export function photoUrl(gid: string, token: string, photoId: string): string {
  return `/api/g/${gid}/photos/${photoId}/file?t=${encodeURIComponent(token)}`;
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

export async function resizeImage(file: File, maxSide = 1600): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale);
  const height = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("画像を変換できませんでした。"))), "image/jpeg", 0.8),
  );
  return { blob, width, height };
}
