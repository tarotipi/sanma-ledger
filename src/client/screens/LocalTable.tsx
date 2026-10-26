// デバッグ卓（DBG-01〜03）。通信なしでエンジンを直接動かし、1画面で3人分を操作する。
// 不具合の再現用：シードを控えれば同じ山を何度でも作れる。状態JSONをコピーして報告・読み込みできる。

import { useMemo, useState } from "react";
import { navigate } from "../router";
import { useGroup } from "../store";
import { DebugHands, TableView } from "../game/TableView";
import type { GameAction, PlayerView } from "../../shared/game/protocol";
import { applyAction, createGame, handleTimeout, nextDeadline, viewFor } from "../../shared/game/engine";
import "../game/game.css";

type GameState = ReturnType<typeof createGame>;

/** handleTimeout の戻りが state そのものでも {state} でも受けられるようにする */
function unwrapState(r: unknown, fallback: GameState): GameState {
  if (r && typeof r === "object" && "state" in r) return (r as { state: GameState }).state;
  return (r as GameState | undefined) ?? fallback;
}

function hasAnyOption(v: PlayerView): boolean {
  const o = v.you?.options;
  if (!o) return false;
  return o.discard || o.tsumo || o.ron || o.pon || o.pass || o.nextHand || o.nuki || o.kan.length > 0;
}

/** 自動で1手：鳴き待ちはパス、手番はツモ切り、局結果は次へ */
function autoActionFor(v: PlayerView): GameAction | null {
  const o = v.you?.options;
  if (!o || !v.you) return null;
  if (o.nextHand) return { type: "next_hand" };
  if (o.pass && !o.discard) return { type: "pass" };
  if (o.nuki) return { type: "nuki" }; // 花は打牌できないので先に抜く（R-24）
  if (o.discard) {
    if (v.you.drawn) return { type: "discard", drawn: true };
    return { type: "discard", index: v.you.hand.length - 1 };
  }
  return null;
}

export function LocalTableScreen() {
  const { state: group, gid } = useGroup();
  const players = useMemo(() => {
    const ms = (group?.members ?? []).filter((m) => !m.hidden).slice(0, 3);
    if (ms.length === 3) return ms.map((m) => ({ id: m.id, name: m.name }));
    return [
      { id: "p1", name: "テスト東" },
      { id: "p2", name: "テスト南" },
      { id: "p3", name: "テスト西" },
    ];
  }, [group]);

  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 100000)));
  const [game, setGame] = useState<GameState>(() => createGame(players, { seed: Number(seed) || 1, now: Date.now() }));
  const [active, setActive] = useState(0);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [json, setJson] = useState("");

  const views: PlayerView[] = useMemo(() => players.map((p) => viewFor(game, p.id, { debug: true })), [game, players]);

  // 「手番を追う」：今操作が必要な人に自動で切り替える（ロン・ポンの判断を優先）
  const needIdx = views.map((v) => hasAnyOption(v));
  const callIdx = views.findIndex((v) => !!v.you && (v.you.options.ron || v.you.options.pon || v.you.options.kan.length > 0) && !v.you.options.discard);
  const shown = follow && !needIdx[active] ? (callIdx >= 0 ? callIdx : Math.max(0, needIdx.indexOf(true))) : active;
  const view: PlayerView | undefined = views[shown];

  const act = (idx: number, action: GameAction) => {
    const r = applyAction(game, players[idx].id, action, Date.now());
    if (r.error) setError(r.error);
    else setError(null);
    setGame(r.state);
  };

  const deal = () => {
    const s = Number(seed) || 1;
    setGame(createGame(players, { seed: s, now: Date.now() }));
    setError(null);
  };

  const autoStep = (limit: number) => {
    let g = game;
    for (let n = 0; n < limit; n++) {
      let moved = false;
      for (let i = 0; i < players.length; i++) {
        const v: PlayerView = viewFor(g, players[i].id, { debug: true });
        const a = autoActionFor(v);
        if (!a) continue;
        const r = applyAction(g, players[i].id, a, Date.now());
        if (r.error) {
          setError(`${players[i].name}: ${r.error}`);
          setGame(g);
          return;
        }
        g = r.state;
        moved = true;
        break;
      }
      const phase: PlayerView["phase"] = viewFor(g, players[0].id, {}).phase;
      if (!moved || (limit > 1 && phase !== "playing")) break;
    }
    setGame(g);
  };

  const forceTimeout = () => {
    const dl = nextDeadline(game);
    const t = (typeof dl === "number" ? dl : Date.now()) + 1;
    setGame(unwrapState(handleTimeout(game, t), game));
  };

  const copyJson = async () => {
    const text = JSON.stringify(game);
    setJson(text);
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
    } catch {
      setError("コピーできませんでした。下の欄から手動でコピーしてください。");
    }
  };

  const loadJson = () => {
    try {
      setGame(JSON.parse(json) as GameState);
      setError(null);
    } catch {
      setError("状態JSONを読み込めませんでした。");
    }
  };

  const errorBar = error && (
    <div className="err-bar" role="alert">
      <span>{error}</span>
      <button type="button" onClick={() => setError(null)} aria-label="閉じる">
        ×
      </button>
    </div>
  );
  const backButton = (
    <button type="button" className="mj-back" onClick={() => navigate(`/g/${gid}/table`)} aria-label="卓の入口に戻る">
      ‹
    </button>
  );

  // 卓は上部のバーを出さず全画面で表示する。席の切り替えやデバッグ操作は卓の下（スクロールした先）に置く
  return (
    <>
      {view ? (
        <TableView view={view} onAction={(a) => act(shown, a)} onExit={deal} menu={backButton} />
      ) : (
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}/table`)} aria-label="戻る">
            ‹
          </button>
          <h1>デバッグ卓</h1>
          <span className="me">シード {seed}</span>
        </header>
      )}
      {view && errorBar && <div className="mj-toast">{errorBar}</div>}
      <main className="page">
        <h2>デバッグ卓（シード {seed}）</h2>
        <div className="seat-tabs" role="tablist" aria-label="操作する席">
          {players.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={shown === i}
              className={`${shown === i ? "on" : ""}${needIdx[i] ? " need" : ""}`}
              onClick={() => {
                setActive(i);
                setFollow(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <label className="note">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 操作が必要な人に自動で切り替える
        </label>

        {!view && errorBar}

        {view && <DebugHands view={view} />}

        <div className="debug-box">
          <div className="row">
            <label>
              シード{" "}
              <input type="number" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
            </label>
            <button type="button" className="btn small primary" onClick={deal}>
              配り直し
            </button>
            <button type="button" className="btn small" onClick={() => setSeed(String(Math.floor(Math.random() * 100000)))}>
              シードを変える
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => autoStep(1)}>
              自動で1手（ツモ切り／パス）
            </button>
            <button type="button" className="btn small" onClick={() => autoStep(500)}>
              局が終わるまで自動
            </button>
            <button type="button" className="btn small ghost" onClick={forceTimeout}>
              時間切れを起こす
            </button>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => void copyJson()}>
              状態JSONをコピー
            </button>
            <button type="button" className="btn small ghost" onClick={loadJson} disabled={!json}>
              下のJSONを読み込む
            </button>
          </div>
          <textarea
            aria-label="状態JSON"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder="ここに状態JSONを貼り付けると、その局面から再開できます"
          />
        </div>

        {view && view.log.length > 0 && (
          <ul className="debug-log" aria-label="ログ">
            {view.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
