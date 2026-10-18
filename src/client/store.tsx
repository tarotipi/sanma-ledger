import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, loadGroups, request, saveGroup, type SavedGroup } from "./api";
import type { Game, GroupState, Member, Session } from "../shared/types";

type Api = <T>(method: string, path: string, body?: unknown, extra?: { raw?: Blob; query?: Record<string, string> }) => Promise<T>;

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

  const setSaved = useCallback((g: SavedGroup | null) => {
    if (g) saveGroup(g);
    setSavedState(g);
  }, []);

  const api: Api = useCallback(
    async <T,>(method: string, path: string, body?: unknown, extra?: { raw?: Blob; query?: Record<string, string> }) => {
      const s = savedRef.current;
      try {
        return await request<T>(method, `/g/${gid}${path}`, {
          token: s?.token,
          memberId: s?.memberId,
          body,
          raw: extra?.raw,
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

  const member = useMemo(
    () => state?.members.find((m) => m.id === saved?.memberId) ?? null,
    [state, saved?.memberId],
  );

  const value = useMemo(
    () => ({ gid, saved, state, loadError, setSaved, refresh, api, patchState, toast, member }),
    [gid, saved, state, loadError, setSaved, refresh, api, patchState, toast, member],
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
