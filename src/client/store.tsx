import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, loadGroups, rememberLastGroup, request, saveGroup, type SavedGroup } from "./api";
import { flushOutbox, listOutbox, subscribeOutbox, type OutboxItem } from "./outbox";
import type { Game, GroupState, Member, Session } from "../shared/types";
import { isRetryableStatus } from "../shared/yakuman";

type Extra = { raw?: Blob; form?: FormData; query?: Record<string, string> };
type Api = <T>(method: string, path: string, body?: unknown, extra?: Extra) => Promise<T>;

type Ctx = {
  gid: string;
  saved: SavedGroup | null;
  state: GroupState | null;
  loadError: string | null;
  setSaved: (g: SavedGroup | null) => void;
  refresh: () => Promise<void>;
  api: Api;
  /** 楽観的更新：保存前に画面へ反映する */
  patchState: (fn: (s: GroupState) => GroupState) => void;
  toast: (msg: string) => void;
  member: Member | null;
  /** 管理者モード：確認画面を飛ばして、どの半荘でも自由に編集できる（変更は履歴に残る） */
  admin: boolean;
  /** サーバーで確かめた管理者パスワード（この画面を開いているあいだだけ持つ）。null で管理者モードを終える */
  adminPw: string | null;
  setAdminPw: (pw: string | null) => void;
  /** 送信待ちの役満と写真 */
  outbox: OutboxItem[];
  flush: () => Promise<void>;
};

const GroupCtx = createContext<Ctx | null>(null);

export function useGroup(): Ctx {
  const c = useContext(GroupCtx);
  if (!c) throw new Error("GroupProvider がありません");
  return c;
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast ${msg ? "show" : ""}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

export function GroupProvider({ gid, children }: { gid: string; children: ReactNode }) {
  const [saved, setSavedState] = useState<SavedGroup | null>(() => loadGroups()[gid] ?? null);
  const [state, setState] = useState<GroupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const versionRef = useRef(0);

  // このグループを開いている間は、ホーム画面に追加するとこのグループから開くようにする
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    const before = link.getAttribute("href") ?? "/manifest.webmanifest";
    link.setAttribute("href", `/api/manifest/${gid}`);
    rememberLastGroup(gid);
    // 入室情報をブラウザに消されにくくする（対応していない端末では何もしない）
    void navigator.storage?.persist?.().catch(() => undefined);
    return () => {
      link.setAttribute("href", before);
    };
  }, [gid]);

  const setSaved = useCallback((g: SavedGroup | null) => {
    if (g) saveGroup(g);
    setSavedState(g);
  }, []);

  const api: Api = useCallback(
    async <T,>(method: string, path: string, body?: unknown, extra?: Extra) => {
      const s = savedRef.current;
      try {
        return await request<T>(method, `/g/${gid}${path}`, {
          token: s?.token,
          memberId: s?.memberId,
          body,
          raw: extra?.raw,
          form: extra?.form,
          query: extra?.query,
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setSavedState(null);
        throw e;
      }
    },
    [gid],
  );

  const refresh = useCallback(async () => {
    if (!savedRef.current) return;
    try {
      const s = await api<GroupState>("GET", "/state");
      versionRef.current = s.version;
      setState(s);
      setLoadError(null);
      if (savedRef.current && savedRef.current.name !== s.group.name) {
        const g = { ...savedRef.current, name: s.group.name };
        saveGroup(g);
        setSavedState(g);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }, [api]);

  useEffect(() => {
    if (saved) void refresh();
  }, [saved?.token, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ほかの人の変更を4秒ごとに確認（画面を見ているときだけ）
  useEffect(() => {
    if (!saved) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { version } = await api<{ version: number }>("GET", "/version");
        if (version !== versionRef.current) await refresh();
      } catch {
        /* 次の確認で再試行 */
      }
    };
    const id = window.setInterval(check, 4000);
    const onVis = () => void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [saved, api, refresh]);

  const patchState = useCallback((fn: (s: GroupState) => GroupState) => {
    setState((s) => (s ? fn(s) : s));
  }, []);

  const [adminPw, setAdminPw] = useState<string | null>(null);
  const admin = adminPw !== null;

  // ---- 送信待ちの役満と写真 ----
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  useEffect(() => {
    const load = () => void listOutbox(gid).then(setOutbox);
    load();
    return subscribeOutbox(load);
  }, [gid]);

  const flush = useCallback(async () => {
    if (!savedRef.current) return;
    const sent = await flushOutbox(gid, {
      yakuman: async (x) => {
        await api("POST", "/yakuman", { clientId: x.id, sessionId: x.sessionId, gameId: x.gameId, memberId: x.memberId, name: x.name });
      },
      photo: async (x) => {
        const form = new FormData();
        form.set("id", x.id);
        form.set("sessionId", x.sessionId);
        form.set("yakumanId", x.yakumanId);
        form.set("width", String(x.width));
        form.set("height", String(x.height));
        form.set("full", new File([x.full], "full.jpg", { type: "image/jpeg" }));
        form.set("thumb", new File([x.thumb], "thumb.jpg", { type: "image/jpeg" }));
        await api("POST", "/photos", undefined, { form });
      },
      retryable: (e) => !(e instanceof ApiError) || isRetryableStatus(e.status),
      report: (x, e) => {
        // ログ送信の失敗は無視する（電波がないときは届かない）
        void api("POST", "/client-log", {
          kind: `outbox-${x.kind}`,
          message: e instanceof Error ? e.message : String(e),
          detail: e instanceof ApiError ? `status=${e.status}` : "",
        }).catch(() => undefined);
      },
    });
    if (sent) await refresh();
  }, [gid, api, refresh]);

  // 起動時・電波が戻ったとき・画面に戻ったとき、それと送信待ちがある間は20秒ごとに送る
  const hasWaiting = outbox.some((x) => !x.dead && !(x.kind === "photo" && x.hold));
  useEffect(() => {
    if (!saved) return;
    void flush();
    const onWake = () => {
      if (document.visibilityState === "visible") void flush();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    const id = hasWaiting ? window.setInterval(onWake, 20_000) : undefined;
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.clearInterval(id);
    };
  }, [saved, flush, hasWaiting]);

  const member = useMemo(
    () => state?.members.find((m) => m.id === saved?.memberId) ?? null,
    [state, saved?.memberId],
  );

  const value = useMemo(
    () => ({ gid, saved, state, loadError, setSaved, refresh, api, patchState, toast, member, admin, adminPw, setAdminPw, outbox, flush }),
    [gid, saved, state, loadError, setSaved, refresh, api, patchState, toast, member, admin, adminPw, outbox, flush],
  );
  return <GroupCtx.Provider value={value}>{children}</GroupCtx.Provider>;
}

// ---------- 便利な取り出し ----------

export function liveGames(state: GroupState, sessionId?: string): Game[] {
  return state.games.filter((g) => !g.deletedAt && (!sessionId || g.sessionId === sessionId));
}

/** 通算成績用：セッションの日付順 → 半荘番号順 */
export function gamesInOrder(state: GroupState, sessionId?: string): Game[] {
  const order = new Map<string, Session>(state.sessions.map((s) => [s.id, s]));
  const live = new Set(state.sessions.filter((s) => !s.deletedAt).map((s) => s.id));
  return liveGames(state, sessionId)
    .filter((g) => live.has(g.sessionId))
    .sort((a, b) => {
      const sa = order.get(a.sessionId);
      const sb = order.get(b.sessionId);
      if (a.sessionId !== b.sessionId)
        return (sa?.playedOn ?? "").localeCompare(sb?.playedOn ?? "") || (sa?.createdAt ?? "").localeCompare(sb?.createdAt ?? "");
      return a.seq - b.seq;
    });
}

export function memberMap(state: GroupState): Map<string, Member> {
  return new Map(state.members.map((m) => [m.id, m]));
}
