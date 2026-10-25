// 卓の描画（オンライン卓とデバッグ卓で共用）。PlayerView を受け取り、操作は onAction で返すだけ。
// ここで点数やルールの計算はしない（全部サーバー／エンジンが決めた値を表示する）。

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  GameAction,
  HandResult,
  PlayerPublic,
  PlayerView,
  SeatIndex,
} from "../../shared/game/protocol";
import type { ScoreRank } from "../../shared/game/rules";
import type { Tile as TileT } from "../../shared/game/tiles";
import { Tile, faceLabel } from "./Tile";
import "./game.css";

export interface TableViewProps {
  view: PlayerView;
  onAction: (action: GameAction) => void;
  /** 終局画面の「戻る」 */
  onExit?: () => void;
}

const WIND_NAME: Record<string, string> = { "1z": "東", "2z": "南", "3z": "西", "4z": "北" };
const SEAT_WIND = ["東", "南", "西"];

const RANK_NAME: Record<ScoreRank, string> = {
  "1han": "1翻",
  "2han": "2翻",
  "3han": "3翻",
  mangan: "満貫",
  haneman: "跳満",
  baiman: "倍満",
  sanbaiman: "三倍満",
  yakuman: "役満",
};

function rankText(rank: ScoreRank, multiplier: number): string {
  if (rank !== "yakuman") return RANK_NAME[rank];
  if (multiplier >= 3) return `${multiplier}倍役満`;
  if (multiplier === 2) return "ダブル役満";
  return "役満";
}

function seatWindOf(seat: SeatIndex, dealer: SeatIndex): string {
  return SEAT_WIND[(seat - dealer + 3) % 3];
}

function signed(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`;
  return "±0";
}

/** 手番の残り秒（1秒ごとに描き直す） */
function useSecondsLeft(deadline: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// ---- 部品 ----

function Melds({ p, size }: { p: PlayerPublic; size: "xs" | "sm" }) {
  if (p.melds.length === 0) return null;
  return (
    <div className="melds">
      {p.melds.map((m, i) => {
        const tiles: TileT[] = p.meldTiles[i] ?? Array.from({ length: m.kind === "pon" ? 3 : 4 }, () => ({ face: m.face }));
        return (
          <span key={i} className="meld" title={m.kind === "ankan" ? "暗槓" : m.kind === "pon" ? "ポン" : "カン"}>
            {tiles.map((t, j) => (
              <Tile
                key={j}
                tile={t}
                size={size}
                back={m.kind === "ankan" && (j === 0 || j === tiles.length - 1)}
                sideways={m.kind !== "ankan" && j === 0}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}

function Flowers({ p }: { p: PlayerPublic }) {
  if (p.flowers.length === 0) return null;
  return (
    <span className="flowers" aria-label="抜いた花">
      {p.flowers.map((f, i) => (
        <Tile key={i} flower={f} size="xs" />
      ))}
    </span>
  );
}

function PlayerBadge({ p, view, turn }: { p: PlayerPublic; view: PlayerView; turn: boolean }) {
  const dealer = view.round?.dealerSeat ?? 0;
  return (
    <div className={`pbadge${turn ? " turn" : ""}`}>
      <span className="wind">{seatWindOf(p.seat, dealer)}</span>
      <span className="pname">
        {p.name}
        {!p.connected && <em className="off">切断</em>}
      </span>
      <span className="pscore">{p.score.toLocaleString()}</span>
      <span className="pchips" title={`チップ（バイイン${p.buyins}回）`}>
        ◎{p.chips}
      </span>
      {p.riichi && <span className="riichi-stick" aria-label="リーチ中" />}
    </div>
  );
}

function Opponent({ p, view }: { p: PlayerPublic; view: PlayerView }) {
  const turn = view.turnSeat === p.seat && view.phase === "playing";
  return (
    <section className="opp" aria-label={`${p.name}の席`}>
      <PlayerBadge p={p} view={view} turn={turn} />
      <div className="opp-hand" aria-label={`手牌${p.handCount}枚`}>
        {Array.from({ length: p.handCount }, (_, i) => (
          <Tile key={i} back size="xs" />
        ))}
      </div>
      <div className="opp-side">
        <Flowers p={p} />
        <Melds p={p} size="xs" />
      </div>
    </section>
  );
}

function Pond({ p, view, mine }: { p: PlayerPublic; view: PlayerView; mine: boolean }) {
  const last = view.lastDiscard;
  return (
    <div className={`pond${mine ? " mine" : ""}`}>
      <span className="pond-name">{p.name}</span>
      <div className="pond-tiles">
        {p.discards.map((t, i) => {
          const isLast = !!last && last.seat === p.seat && i === p.discards.length - 1;
          return (
            <Tile
              key={i}
              tile={t}
              size="sm"
              sideways={p.riichiDiscardIndex === i}
              dim={p.calledDiscards.includes(i)}
              className={isLast ? "last" : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function CenterInfo({ view }: { view: PlayerView }) {
  const r = view.round;
  return (
    <div className="center">
      <div className="round">
        {r ? (
          <>
            <strong>
              {WIND_NAME[r.wind] ?? ""}
              {r.number}局
            </strong>
            <span>{r.honba}本場</span>
            <span>供託{r.riichiSticks}</span>
          </>
        ) : (
          <strong>待機中</strong>
        )}
      </div>
      <div className="wall">残り {view.wallRemaining}</div>
      <div className="dora" aria-label="ドラ表示牌">
        <span>ドラ表示</span>
        {view.doraIndicators.map((f, i) => (
          <Tile key={i} face={f} size="xs" />
        ))}
      </div>
    </div>
  );
}

// ---- 結果 ----

function ResultPanel({ view, result, onAction }: { view: PlayerView; result: HandResult; onAction: (a: GameAction) => void }) {
  const name = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? "—";
  const ready = view.players.filter((p) => p.ready).length;
  const canNext = !!view.you?.options.nextHand;
  const meReady = view.players.find((p) => p.id === view.you?.id)?.ready ?? false;

  return (
    <div className="result-overlay" role="dialog" aria-modal="true" aria-label="局の結果">
      <div className="result">
        {result.kind === "win" ? (
          <>
            <h2>
              {name(result.winnerId)}　{result.winBy === "tsumo" ? "ツモ" : `ロン（${name(result.discarderId)}から）`}
            </h2>
            <div className="result-hand">
              {result.hand.map((t, i) => (
                <Tile key={i} tile={t} size="sm" />
              ))}
              {result.melds.map((m, i) => (
                <span key={`m${i}`} className="meld">
                  {Array.from({ length: m.kind === "pon" ? 3 : 4 }, (_, j) => (
                    <Tile key={j} face={m.face} size="sm" />
                  ))}
                </span>
              ))}
              <span className="wintile">
                <small>和了牌</small>
                <Tile face={result.winTile} size="sm" />
              </span>
            </div>
            {result.pocchiWin && <p className="note gold">白ポッチで和了（{faceLabel(result.winTile)}として計算）</p>}
            {result.yakumanNames.length > 0 ? (
              <p className="yakuman-name">{result.yakumanNames.join("・")}</p>
            ) : (
              <ul className="yaku-list">
                {result.yaku.map((y, i) => (
                  <li key={i}>
                    <span>{y.name}</span>
                    <b>{y.han}翻</b>
                  </li>
                ))}
              </ul>
            )}
            <p className="rank-line">
              {result.yakumanNames.length === 0 && <span>{result.han}翻　</span>}
              <strong>{rankText(result.rank, result.multiplier)}</strong>
            </p>
            <div className="ind-row">
              <span>ドラ表示</span>
              {result.doraIndicators.map((f, i) => (
                <Tile key={i} face={f} size="xs" />
              ))}
              {result.uraIndicators.length > 0 && (
                <>
                  <span>裏</span>
                  {result.uraIndicators.map((f, i) => (
                    <Tile key={`u${i}`} face={f} size="xs" />
                  ))}
                </>
              )}
            </div>
            {result.winterRevealed.length > 0 && (
              <div className="ind-row">
                <span>冬でめくれた牌</span>
                {result.winterRevealed.map((f, i) => (
                  <Tile key={i} face={f} size="xs" />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2>流局</h2>
            {result.nagashiIds.length > 0 && (
              <p className="yakuman-name">流し役満：{result.nagashiIds.map(name).join("・")}</p>
            )}
            <p>テンパイ：{result.tenpaiIds.length ? result.tenpaiIds.map(name).join("・") : "なし"}</p>
            {Object.entries(result.revealed).map(([id, tiles]) => (
              <div key={id} className="revealed">
                <small>{name(id)}</small>
                <div className="result-hand">
                  {tiles.map((t, i) => (
                    <Tile key={i} tile={t} size="xs" />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <table className="delta-table">
          <thead>
            <tr>
              <th>名前</th>
              <th>点数</th>
              <th>チップ</th>
            </tr>
          </thead>
          <tbody>
            {view.players.map((p) => {
              const d = result.deltas[p.id] ?? 0;
              const c = result.chipDeltas[p.id] ?? 0;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className={d > 0 ? "plus" : d < 0 ? "minus" : ""}>{signed(d)}</td>
                  <td className={c > 0 ? "plus" : c < 0 ? "minus" : ""}>{c === 0 ? "—" : `${c > 0 ? "+" : "−"}${Math.abs(c)}枚`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button
          type="button"
          className="btn primary wide"
          disabled={!canNext || meReady}
          onClick={() => onAction({ type: "next_hand" })}
        >
          {meReady ? `待っています（${ready}/3）` : `次の局へ（${ready}/3）`}
        </button>
      </div>
    </div>
  );
}

function FinalPanel({ view, onExit }: { view: PlayerView; onExit?: () => void }) {
  const f = view.final;
  if (!f) return null;
  const rows = view.players
    .map((p) => ({ p, score: f.scores[p.id] ?? p.score, chip: f.chipNet[p.id] ?? 0, buyins: f.buyins[p.id] ?? 1 }))
    .sort((a, b) => b.score - a.score);
  return (
    <div className="result-overlay" role="dialog" aria-modal="true" aria-label="終局">
      <div className="result">
        <h2>終局</h2>
        <table className="delta-table">
          <thead>
            <tr>
              <th>順位</th>
              <th>名前</th>
              <th>持ち点</th>
              <th>チップ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.p.id}>
                <td>{i + 1}</td>
                <td>{r.p.name}</td>
                <td>{r.score.toLocaleString()}</td>
                <td className={r.chip > 0 ? "plus" : r.chip < 0 ? "minus" : ""}>
                  {r.chip > 0 ? "+" : r.chip < 0 ? "−" : ""}
                  {Math.abs(r.chip)}枚
                  {r.buyins > 1 && <small>（バイイン{r.buyins}回）</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.yakuman.length > 0 && (
          <p className="yakuman-name">
            役満：{f.yakuman.map((y) => `${view.players.find((p) => p.id === y.playerId)?.name ?? ""} ${y.names.join("・")}`).join("／")}
          </p>
        )}
        <p className="note">対戦記録に登録しました。精算はセッションの「精算」タブで確認できます。</p>
        {onExit && (
          <button type="button" className="btn primary wide" onClick={onExit}>
            グループに戻る
          </button>
        )}
      </div>
    </div>
  );
}

// ---- 本体 ----

export function TableView({ view, onAction, onExit }: TableViewProps): ReactElement {
  const you = view.you;
  const [selected, setSelected] = useState<number | null>(null); // 手牌index、ツモ牌は -1
  const [riichiMode, setRiichiMode] = useState(false);
  const secs = useSecondsLeft(you?.deadline);

  const opts = you?.options;
  // 手番が変わったら選択とリーチ選択をリセット
  const turnKey = `${view.turnSeat}-${you?.hand.length}-${you?.drawn ? 1 : 0}-${opts?.discard ? 1 : 0}`;
  useEffect(() => {
    setSelected(null);
    setRiichiMode(false);
  }, [turnKey]);

  const me = useMemo(() => view.players.find((p) => p.id === you?.id) ?? null, [view.players, you?.id]);
  const mySeat = you?.seat ?? 0;
  const right = view.players.find((p) => p.seat === (mySeat + 1) % 3);
  const left = view.players.find((p) => p.seat === (mySeat + 2) % 3);
  const ponds = [left, right, me].filter((p): p is PlayerPublic => !!p);

  const canPick = (idx: number): boolean => {
    if (!opts?.discard) return false;
    if (riichiMode) return opts.riichiDiscards.includes(idx);
    if (me?.riichi) return idx === -1; // リーチ後はツモ切りのみ
    return true;
  };

  const tap = (idx: number) => {
    if (!canPick(idx)) return;
    if (selected !== idx) {
      setSelected(idx); // 1回目：選ぶ（誤タップ防止）
      return;
    }
    const action: GameAction =
      idx === -1 ? { type: "discard", drawn: true, riichi: riichiMode || undefined } : { type: "discard", index: idx, riichi: riichiMode || undefined };
    onAction(action);
    setSelected(null);
    setRiichiMode(false);
  };

  const anyCall = !!opts && (opts.ron || opts.pon || opts.kan.length > 0 || opts.tsumo || opts.riichi || opts.pass);

  return (
    <div className="mj">
      <div className="opps">
        {left && <Opponent p={left} view={view} />}
        {right && <Opponent p={right} view={view} />}
      </div>

      <CenterInfo view={view} />

      <div className="ponds">
        {ponds.map((p) => (
          <Pond key={p.id} p={p} view={view} mine={p.id === me?.id} />
        ))}
      </div>

      {me && you && (
        <section className="mine" aria-label="自分の席">
          <div className="mine-head">
            <PlayerBadge p={me} view={view} turn={view.turnSeat === me.seat && view.phase === "playing"} />
            <Flowers p={me} />
            {secs !== null && <span className={`timer${secs <= 3 ? " hurry" : ""}`}>{secs}秒</span>}
          </div>

          {you.waits.length > 0 && (
            <div className="waits" aria-label="待ち牌">
              <span>待ち：</span>
              {you.waits.map((f) => (
                <Tile key={f} face={f} size="xs" />
              ))}
            </div>
          )}

          <div className="hand" role="group" aria-label="手牌">
            {you.hand.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`hand-tile${selected === i ? " sel" : ""}${canPick(i) ? "" : " locked"}`}
                onClick={() => tap(i)}
                aria-pressed={selected === i}
              >
                <Tile tile={t} size="fluid" />
              </button>
            ))}
            {you.drawn && (
              <button
                type="button"
                className={`hand-tile drawn${selected === -1 ? " sel" : ""}${canPick(-1) ? "" : " locked"}`}
                onClick={() => tap(-1)}
                aria-pressed={selected === -1}
              >
                <Tile tile={you.drawn} size="fluid" />
              </button>
            )}
          </div>

          <Melds p={me} size="sm" />

          {selected !== null && opts?.discard && (
            <p className="hint">{riichiMode ? "もう一度タップでリーチ宣言して切ります" : "もう一度タップで切ります"}</p>
          )}

          {anyCall && opts && view.phase === "playing" && (
            <div className="actions">
              {opts.riichi && !riichiMode && !me.riichi && (
                <button type="button" className="act riichi" onClick={() => setRiichiMode(true)}>
                  リーチ
                </button>
              )}
              {riichiMode && (
                <button type="button" className="act" onClick={() => setRiichiMode(false)}>
                  リーチ取消
                </button>
              )}
              {opts.tsumo && (
                <button type="button" className="act win" onClick={() => onAction({ type: "tsumo" })}>
                  ツモ
                </button>
              )}
              {opts.ron && (
                <button type="button" className="act win" onClick={() => onAction({ type: "ron" })}>
                  ロン
                </button>
              )}
              {opts.pon && (
                <button type="button" className="act" onClick={() => onAction({ type: "pon" })}>
                  ポン
                </button>
              )}
              {opts.kan.map((f) => (
                <button key={f} type="button" className="act" onClick={() => onAction({ type: "kan", face: f })}>
                  カン {faceLabel(f)}
                </button>
              ))}
              {opts.pass && (
                <button type="button" className="act ghost" onClick={() => onAction({ type: "pass" })}>
                  パス
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {view.log.length > 0 && <p className="lastlog">{view.log[0]}</p>}

      {view.phase === "hand_end" && view.result && <ResultPanel view={view} result={view.result} onAction={onAction} />}
      {view.phase === "game_end" && <FinalPanel view={view} onExit={onExit} />}
    </div>
  );
}

/** デバッグ表示：全員の手牌（DBG-01） */
export function DebugHands({ view }: { view: PlayerView }) {
  if (!view.debugHands) return null;
  return (
    <section className="debug-hands" aria-label="全員の手牌（デバッグ）">
      {view.players.map((p) => (
        <div key={p.id} className="debug-hand">
          <small>
            {p.name}（席{p.seat}）
          </small>
          <div className="result-hand">
            {(view.debugHands?.[p.id] ?? []).map((t, i) => (
              <Tile key={i} tile={t} size="xs" />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
