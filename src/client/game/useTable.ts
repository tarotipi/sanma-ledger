// オンライン卓のWebSocket接続フック。切れたら自動で数回つなぎ直す。
// サーバー（worker/table.ts）との約束：
//   client→server: join / leave / start / action / debug / reset
//   server→client: lobby / view / error

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameAction, PlayerView } from "../../shared/game/protocol";

export type LobbySeat = { memberId: string; name: string; connected: boolean } | null;

export interface LobbyState {
  seats: LobbySeat[];
  started: boolean;
}

export type ClientMsg =
  | { t: "join"; memberId: string; name: string }
  | { t: "leave" }
  | { t: "start"; seed?: number }
  | { t: "action"; action: GameAction }
  | { t: "debug"; on: boolean }
  | { t: "reset" };

export type ServerMsg =
  | { t: "lobby"; seats: LobbySeat[]; started: boolean }
  | { t: "view"; view: PlayerView }
  | { t: "error"; message: string };

export type ConnStatus = "connecting" | "open" | "closed";

export interface TableConn {
  status: ConnStatus;
  lobby: LobbyState | null;
  view: PlayerView | null;
  error: string | null;
  clearError: () => void;
  send: (msg: ClientMsg) => void;
  /** 着席（切断→再接続のときは自動で再送する） */
  sit: (memberId: string, name: string) => void;
  leave: () => void;
  /** 手動でつなぎ直す */
  reconnect: () => void;
}

const MAX_RETRY = 6;

function wsUrl(gid: string, token: string, memberId: string | null): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // サーバーの requireAuth は ?t= を読む（ブラウザの WebSocket はヘッダーを付けられないため）
  const q = new URLSearchParams({ t: token });
  if (memberId) q.set("member", memberId);
  return `${proto}://${location.host}/api/table/${encodeURIComponent(gid)}/ws?${q.toString()}`;
}

function isServerMsg(v: unknown): v is ServerMsg {
  return typeof v === "object" && v !== null && typeof (v as { t?: unknown }).t === "string";
}

export function useTable(gid: string, token: string | null, memberId: string | null): TableConn {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const sitRef = useRef<{ memberId: string; name: string } | null>(null);
  const aliveRef = useRef(true);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    aliveRef.current = true;
    if (!token) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(gid, token, memberId));
    } catch {
      setStatus("closed");
      setError("卓に接続できませんでした。");
      return;
    }
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      retryRef.current = 0;
      setStatus("open");
      const s = sitRef.current;
      if (s) ws.send(JSON.stringify({ t: "join", memberId: s.memberId, name: s.name } satisfies ClientMsg));
    };
    ws.onmessage = (ev: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (!isServerMsg(data)) return;
      if (data.t === "lobby") {
        setLobby({ seats: data.seats, started: data.started });
        if (!data.started) setView(null);
      } else if (data.t === "view") setView(data.view);
      else if (data.t === "error") setError(data.message);
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (!aliveRef.current) return;
      setStatus("closed");
      if (retryRef.current < MAX_RETRY) {
        const wait = Math.min(8000, 800 * 2 ** retryRef.current);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(() => setEpoch((e) => e + 1), wait);
      }
    };
    ws.onerror = () => {
      /* onclose で処理する */
    };

    return () => {
      aliveRef.current = false;
      window.clearTimeout(timerRef.current);
      ws.onclose = null;
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [gid, token, memberId, epoch]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("通信が切れています。つなぎ直しています…");
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  const sit = useCallback(
    (mid: string, name: string) => {
      sitRef.current = { memberId: mid, name };
      send({ t: "join", memberId: mid, name });
    },
    [send],
  );

  const leave = useCallback(() => {
    sitRef.current = null;
    send({ t: "leave" });
  }, [send]);

  const reconnect = useCallback(() => {
    retryRef.current = 0;
    setEpoch((e) => e + 1);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { status, lobby, view, error, clearError, send, sit, leave, reconnect };
}
