// オンライン卓（Phase 4）。グループ画面の「卓に入る」から来る。リンクのコピーは不要（I-07）。
// 誰として座るかはグループのメンバーから選ぶ（I-06）。選択はこの端末に保存して次回から自動。

import { useMemo, useState } from "react";
import { navigate } from "../router";
import { useGroup } from "../store";
import { Empty } from "../ui";
import { useTable } from "../game/useTable";
import { DebugHands, TableView } from "../game/TableView";
import "../game/game.css";

function meKey(gid: string): string {
  return `sanma.table.me.${gid}`;
}
function loadMe(gid: string): string | null {
  try {
    return localStorage.getItem(meKey(gid));
  } catch {
    return null;
  }
}
function saveMe(gid: string, id: string): void {
  try {
    localStorage.setItem(meKey(gid), id);
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

export function TableScreen() {
  const { state, saved, gid, member } = useGroup();
  const members = useMemo(() => (state?.members ?? []).filter((m) => !m.hidden), [state]);
  const [meId, setMeId] = useState<string | null>(() => {
    const stored = loadMe(gid);
    return stored && members.some((m) => m.id === stored) ? stored : member?.id ?? null;
  });
  const me = members.find((m) => m.id === meId) ?? null;
  const conn = useTable(gid, saved?.token ?? null, meId);
  const [debug, setDebug] = useState(false);
  const [seed, setSeed] = useState("");

  const lobby = conn.lobby;
  const seats = lobby?.seats ?? [null, null, null];
  const mySeatIdx = seats.findIndex((s) => s?.memberId === meId);
  const seatedCount = seats.filter(Boolean).length;
  const started = !!lobby?.started;
  const view = conn.view;

  const pickMe = (id: string) => {
    setMeId(id);
    saveMe(gid, id);
  };

  const toggleDebug = () => {
    const on = !debug;
    setDebug(on);
    conn.send({ t: "debug", on });
  };

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="戻る">
          ‹
        </button>
        <h1>卓</h1>
        <span className="me">{me?.name}</span>
      </header>
      <main className="page">
        {conn.status !== "open" && (
          <div className="conn-bar" role="status">
            {conn.status === "connecting" ? "卓に接続しています…" : "接続が切れました。つなぎ直しています…"}
            {conn.status === "closed" && (
              <button type="button" className="btn small" onClick={conn.reconnect}>
                今すぐつなぐ
              </button>
            )}
          </div>
        )}
        {conn.error && (
          <div className="err-bar" role="alert">
            <span>{conn.error}</span>
            <button type="button" onClick={conn.clearError} aria-label="閉じる">
              ×
            </button>
          </div>
        )}

        {started && view ? (
          <>
            <TableView
              view={view}
              onAction={(action) => conn.send({ t: "action", action })}
              onExit={() => navigate(`/g/${gid}`)}
            />
            {debug && <DebugHands view={view} />}
          </>
        ) : started ? (
          <Empty>対局中です。{mySeatIdx < 0 ? "この卓の席に座っていないため見られません。" : "読み込み中…"}</Empty>
        ) : (
          <>
            <label className="form">
              <span>あなたは</span>
              <select value={meId ?? ""} onChange={(e) => pickMe(e.target.value)}>
                <option value="" disabled>
                  選んでください
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <ul className="lobby-seats" aria-label="席">
              {seats.map((s, i) => (
                <li key={i}>
                  <span className="seat-no">{i + 1}</span>
                  {s ? <strong>{s.name}</strong> : <span className="empty">空席</span>}
                  {s && <span className={`conn${s.connected ? " on" : ""}`}>{s.connected ? "接続中" : "切断"}</span>}
                </li>
              ))}
            </ul>

            {mySeatIdx < 0 ? (
              <button
                type="button"
                className="btn primary wide xl"
                disabled={!me || seatedCount >= 3 || conn.status !== "open"}
                onClick={() => me && conn.sit(me.id, me.name)}
              >
                {seatedCount >= 3 ? "満席です" : "席に着く"}
              </button>
            ) : (
              <button type="button" className="btn ghost wide" onClick={conn.leave}>
                席を立つ
              </button>
            )}

            <button
              type="button"
              className="btn primary wide"
              disabled={seatedCount < 3 || mySeatIdx < 0}
              onClick={() => conn.send({ t: "start" })}
            >
              対局を始める（{seatedCount}/3）
            </button>
            <p className="note">3人そろったら誰か1人が「対局を始める」を押してください。</p>
          </>
        )}

        <details className="debug-box">
          <summary>デバッグ</summary>
          <div className="row">
            <label>
              シード{" "}
              <input
                type="number"
                inputMode="numeric"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="空なら自動"
              />
            </label>
            <button
              type="button"
              className="btn small"
              disabled={started || seatedCount < 3}
              onClick={() => conn.send({ t: "start", seed: seed === "" ? undefined : Number(seed) })}
            >
              このシードで開始
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={toggleDebug}>
              全員の手牌を{debug ? "隠す" : "見る"}
            </button>
            <button type="button" className="btn small danger ghost" onClick={() => conn.send({ t: "reset" })}>
              卓をリセット
            </button>
            <button type="button" className="btn small ghost" onClick={() => navigate(`/g/${gid}/table/local`)}>
              デバッグ卓（1画面で3人）
            </button>
          </div>
          {view?.log && view.log.length > 0 && (
            <ul className="debug-log">
              {view.log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </details>
      </main>
    </>
  );
}
