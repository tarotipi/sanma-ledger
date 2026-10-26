// 卓の描画（オンライン卓とデバッグ卓で共用）。PlayerView を受け取り、操作は onAction で返すだけ。
// ここで点数やルールの計算はしない（全部サーバー／エンジンが決めた値を表示する）。
// 配置：上に相手2人、中央に情報盤とそれを囲む河（自分=下・下家=右・上家=左）、下に自分の手牌と操作ボタン。

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type {
  ChipDetail,
  GameAction,
  HandResult,
  PlayerPublic,
  PlayerView,
  SeatIndex,
} from "../../shared/game/protocol";
import type { ScoreRank } from "../../shared/game/rules";
import { nextFace, type Face, type Tile as TileT } from "../../shared/game/tiles";
import { Tile, faceLabel, flowerOfTile } from "./Tile";
import "./game.css";

export interface TableViewProps {
  view: PlayerView;
  onAction: (action: GameAction) => void;
  /** 終局画面の「戻る」 */
  onExit?: () => void;
  /** 画面上端の中央（相手2人の間）に置く小さな部品（戻るボタンなど） */
  menu?: ReactNode;
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

/** 現在時刻（active の間だけ 0.25 秒ごとに描き直す） */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

interface Clock {
  /** 表示する秒（overtime のときは超過した秒） */
  seconds: number;
  overtime: boolean;
  /** 超過が何秒で自動ツモ切りになるか（deadline − overtimeFrom から。分からなければ null） */
  limit: number | null;
}

/** 持ち時間の表示（C-08）。overtimeFrom を過ぎたらマイナス秒 */
function clockOf(deadline: number | null, overtimeFrom: number | null, now: number): Clock | null {
  if (deadline === null && overtimeFrom === null) return null;
  const limit = deadline !== null && overtimeFrom !== null && deadline > overtimeFrom ? Math.round((deadline - overtimeFrom) / 1000) : null;
  if (overtimeFrom !== null && now >= overtimeFrom) {
    return { seconds: Math.floor((now - overtimeFrom) / 1000), overtime: true, limit };
  }
  const target = overtimeFrom ?? deadline ?? now;
  return { seconds: Math.max(0, Math.ceil((target - now) / 1000)), overtime: false, limit };
}

/** ドラ判定（表示用）。表示牌の次の牌・赤5・金5 */
type IsDora = (t: TileT) => boolean;

function makeIsDora(indicators: Face[]): IsDora {
  const faces = new Set(indicators.map(nextFace));
  return (t) => !flowerOfTile(t) && (faces.has(t.face) || !!t.red || !!t.gold);
}

function shantenText(n: number): string {
  if (n < 0) return "和了形";
  if (n === 0) return "テンパイ";
  return `${n}シャンテン`;
}

const CHIP_ITEMS: { key: keyof ChipDetail; label: string }[] = [
  { key: "ura", label: "裏ドラ" },
  { key: "ippatsu", label: "一発" },
  { key: "gold", label: "金" },
  { key: "spring", label: "春" },
  { key: "winter", label: "冬" },
  { key: "pocchi", label: "白ポッチ" },
  { key: "yakuman", label: "役満×" },
  { key: "pot", label: "供託" },
];

/** チップ内訳の1行（0の項目は省く） */
function chipDetailText(d: ChipDetail): string {
  return CHIP_ITEMS.filter((it) => d[it.key] > 0)
    .map((it) => `${it.label}${d[it.key]}`)
    .join("・");
}

type Side = "left" | "right" | "bottom";

// ---- 部品 ----

function Melds({ p, size, isDora }: { p: PlayerPublic; size: "xs" | "sm"; isDora: IsDora }) {
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
                dora={isDora(t)}
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

function RiichiMark({ p }: { p: PlayerPublic }) {
  if (!p.riichi) return null;
  return (
    <span className="riichi-mark">
      <span className="riichi-badge">{p.openHand ? "オープンリーチ" : "リーチ"}</span>
      <span className="riichi-stick" aria-hidden="true" />
    </span>
  );
}

/** 相手の席（画面の左上・右上） */
function Opponent({ p, view, side, isDora }: { p: PlayerPublic; view: PlayerView; side: "left" | "right"; isDora: IsDora }) {
  const turn = view.turnSeat === p.seat && view.phase === "playing";
  const dealer = view.round?.dealerSeat ?? 0;
  const open = p.openHand;
  return (
    <section className={`opp opp-${side}${turn ? " turn" : ""}${p.riichi ? " in-riichi" : ""}`} aria-label={`${p.name}の席`}>
      <div className="opp-head">
        <span className="seat-wind">{seatWindOf(p.seat, dealer)}</span>
        <span className="pname">
          {p.name}
          {!p.connected && <em className="off">切断</em>}
        </span>
        {p.isDealer && <span className="dealer-badge">親</span>}
      </div>
      <div className="opp-sub">
        <span className="pchips" title={`チップ（バイイン${p.buyins}回）`}>
          ◎{p.chips}
        </span>
        <RiichiMark p={p} />
      </div>
      {open ? (
        <div className="opp-hand open" aria-label="オープンリーチの手牌">
          {open.map((t, i) => (
            <Tile key={i} tile={t} size="xs" dora={isDora(t)} />
          ))}
          {Array.from({ length: Math.max(0, p.handCount - open.length) }, (_, i) => (
            <Tile key={`b${i}`} back size="xs" />
          ))}
        </div>
      ) : (
        <div className="opp-hand" aria-label={`手牌${p.handCount}枚`}>
          {Array.from({ length: p.handCount }, (_, i) => (
            <Tile key={i} back size="xs" />
          ))}
        </div>
      )}
      {(p.flowers.length > 0 || p.melds.length > 0) && (
        <div className="opp-side">
          <Flowers p={p} />
          <Melds p={p} size="xs" isDora={isDora} />
        </div>
      )}
    </section>
  );
}

/** 河。6枚・6枚で折り返し、3段目は続けて並べる。左右の河は下の河を中央盤の中心で回して置く */
function Pond({ p, view, side }: { p: PlayerPublic; view: PlayerView; side: Side }) {
  const last = view.lastDiscard;
  const rows: { t: TileT; i: number }[][] = [[], [], []];
  p.discards.forEach((t, i) => {
    rows[Math.min(2, Math.floor(i / 6))].push({ t, i });
  });
  return (
    <div className={`pond pond-${side}`} aria-label={`${p.name}の捨て牌`}>
      {rows.map((row, r) =>
        row.length === 0 ? null : (
          <div key={r} className="pond-row">
            {row.map(({ t, i }) => {
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
        ),
      )}
    </div>
  );
}

/** 中央盤の一辺：その方向に座る人の自風と点数。手番なら光る */
function BoardEdge({ p, view, side }: { p: PlayerPublic; view: PlayerView; side: Side }) {
  const turn = view.turnSeat === p.seat && view.phase === "playing";
  const dealer = view.round?.dealerSeat ?? 0;
  return (
    <div className={`edge edge-${side}${turn ? " turn" : ""}${p.isDealer ? " dealer" : ""}`}>
      <span className="edge-label">
        <b className="edge-wind">{seatWindOf(p.seat, dealer)}</b>
        <span className="edge-score">{p.score.toLocaleString()}</span>
      </span>
    </div>
  );
}

function CenterBoard({ view, me, left, right }: { view: PlayerView; me?: PlayerPublic; left?: PlayerPublic; right?: PlayerPublic }) {
  const r = view.round;
  return (
    <div className="mj-board" aria-label="局の情報">
      {me && <BoardEdge p={me} view={view} side="bottom" />}
      {right && <BoardEdge p={right} view={view} side="right" />}
      {left && <BoardEdge p={left} view={view} side="left" />}
      <div className="board-core">
        {r ? (
          <>
            <div className="core-round">
              {WIND_NAME[r.wind] ?? ""}
              {r.number}局
            </div>
            <div className="core-wall">
              残り<b>{view.wallRemaining}</b>枚
            </div>
            <div className="core-sticks">
              {r.honba}本場・供託{r.riichiSticks}
            </div>
          </>
        ) : (
          <div className="core-round">待機中</div>
        )}
        {view.doraIndicators.length > 0 && (
          <div className="core-dora">
            <span className="dora-group" aria-label="ドラ表示牌">
              {view.doraIndicators.map((f, i) => (
                <Tile key={i} face={f} size="xs" />
              ))}
            </span>
            <span className="dora-arrow" aria-hidden="true">
              ▶
            </span>
            <span className="dora-group real" aria-label="ドラ">
              {view.doraIndicators.map((f, i) => (
                <Tile key={i} face={nextFace(f)} size="xs" />
              ))}
            </span>
          </div>
        )}
        {r && (
          <div className={`chip-pot${r.chipPot > 0 ? " on" : ""}`} title="時間超過で出されたチップ。次の和了者が総取り（流局は繰り越し）">
            供託チップ ◎{r.chipPot}
          </div>
        )}
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
            <div className="result-head">
              <span className={`win-by ${result.winBy}`}>{result.winBy === "tsumo" ? "ツモ" : "ロン"}</span>
              <h2>{name(result.winnerId)}</h2>
              {result.winBy === "ron" && <span className="from">{name(result.discarderId)}から</span>}
            </div>
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
            <div className="rank-line">
              {result.yakumanNames.length === 0 && <span className="han">{result.han}翻</span>}
              <strong>{rankText(result.rank, result.multiplier)}</strong>
            </div>
            {result.summerUp && (
              <p className="summer-up">
                <span className="summer-tag">夏</span>
                {RANK_NAME[result.baseRank]}
                <span className="arrow">→</span>
                <strong>{rankText(result.rank, result.multiplier)}</strong>
                <span className="up">ランクアップ</span>
              </p>
            )}
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
            <div className="result-head">
              <h2>流局</h2>
            </div>
            {result.nagashiIds.length > 0 && (
              <p className="yakuman-name">流し役満：{result.nagashiIds.map(name).join("・")}</p>
            )}
            <p className="draw-tenpai">テンパイ：{result.tenpaiIds.length ? result.tenpaiIds.map(name).join("・") : "なし"}</p>
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
                  <td className={`chip-col${c > 0 ? " plus" : c < 0 ? " minus" : ""}`}>
                    {c === 0 ? "—" : `${c > 0 ? "+" : "−"}${Math.abs(c)}枚`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {result.kind === "win" && chipDetailText(result.chipDetail) !== "" && (
          <p className="chip-detail">チップ：{chipDetailText(result.chipDetail)}</p>
        )}

        <button
          type="button"
          className="mj-btn next"
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
        <div className="result-head">
          <h2>終局</h2>
        </div>
        <table className="delta-table final">
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
          <button type="button" className="mj-btn next" onClick={onExit}>
            グループに戻る
          </button>
        )}
      </div>
    </div>
  );
}

// ---- 本体 ----

type RiichiMode = "normal" | "open";

export function TableView({ view, onAction, onExit, menu }: TableViewProps): ReactElement {
  const you = view.you;
  const [selected, setSelected] = useState<number | null>(null); // 手牌index、ツモ牌は -1
  const [riichiMode, setRiichiMode] = useState<RiichiMode | null>(null);
  const clockActive = !!you && (you.deadline !== null || you.overtimeFrom !== null);
  const now = useNow(clockActive);
  const clock = you ? clockOf(you.deadline, you.overtimeFrom, now) : null;

  const opts = you?.options;
  // 手番が変わったら選択とリーチ選択をリセット
  const turnKey = `${view.turnSeat}-${you?.hand.length}-${you?.drawn ? 1 : 0}-${opts?.discard ? 1 : 0}`;
  useEffect(() => {
    setSelected(null);
    setRiichiMode(null);
  }, [turnKey]);

  const me = useMemo(() => view.players.find((p) => p.id === you?.id) ?? undefined, [view.players, you?.id]);
  const isDora = useMemo(() => makeIsDora(view.doraIndicators), [view.doraIndicators]);
  const mySeat = you?.seat ?? 0;
  const right = view.players.find((p) => p.seat === (mySeat + 1) % 3);
  const left = view.players.find((p) => p.seat === (mySeat + 2) % 3);

  const tileAt = (idx: number): TileT | null => (idx === -1 ? (you?.drawn ?? null) : (you?.hand[idx] ?? null));

  const canPick = (idx: number): boolean => {
    if (!opts?.discard) return false;
    if (flowerOfTile(tileAt(idx))) return false; // 花は打牌できない（R-24）
    if (riichiMode) return opts.riichiDiscards.includes(idx);
    if (me?.riichi) return idx === -1; // リーチ後はツモ切りのみ
    return true;
  };

  /** 切るとテンパイになる牌（リーチ選択中はリーチ打牌の候補） */
  const isTenpaiCut = (idx: number): boolean => {
    if (!opts?.discard || !you) return false;
    if (riichiMode) return opts.riichiDiscards.includes(idx);
    if (me?.riichi) return false;
    return you.discardWaits.some((d) => d.index === idx);
  };

  const tap = (idx: number) => {
    if (!canPick(idx)) return;
    if (selected !== idx) {
      setSelected(idx); // 1回目：選ぶ（その牌だけ浮く）
      return;
    }
    const riichi = riichiMode !== null || undefined;
    const open = riichiMode === "open" || undefined;
    const action: GameAction =
      idx === -1 ? { type: "discard", drawn: true, riichi, open } : { type: "discard", index: idx, riichi, open };
    onAction(action);
    setSelected(null);
    setRiichiMode(null);
  };

  const startRiichi = (mode: RiichiMode) => {
    setRiichiMode(mode);
    if (selected !== null && !opts?.riichiDiscards.includes(selected)) setSelected(null);
  };

  const selWaits: Face[] | null =
    selected !== null && you ? (you.discardWaits.find((d) => d.index === selected)?.waits ?? null) : null;
  // 選択中の牌の待ち表示：手牌の左半分なら左寄せ、右半分なら右寄せ
  const selRight = selected !== null && you ? selected === -1 || selected >= you.hand.length / 2 : false;

  const playing = view.phase === "playing";
  const showRiichiButtons = !!opts?.riichi && !me?.riichi && riichiMode === null;
  const myTurn = !!opts?.discard;

  const handTileClass = (idx: number, t: TileT): string => {
    let c = "hand-tile";
    if (idx === -1) c += " drawn";
    if (selected === idx) c += " sel";
    if (flowerOfTile(t)) c += " flower";
    else if (!canPick(idx)) c += " locked";
    if (isTenpaiCut(idx)) c += " tenpai-cut";
    return c;
  };

  const hasActions =
    playing &&
    !!opts &&
    (opts.nuki || showRiichiButtons || riichiMode !== null || opts.tsumo || opts.ron || opts.pon || opts.kan.length > 0 || opts.pass);

  return (
    <div className="mj">
      <div className="mj-stage">
        <header className="mj-top">
          {left ? <Opponent p={left} view={view} side="left" isDora={isDora} /> : <span />}
          <div className="mj-menu">{menu}</div>
          {right ? <Opponent p={right} view={view} side="right" isDora={isDora} /> : <span />}
        </header>

        {view.log.length > 0 && <p className="lastlog">{view.log[0]}</p>}

        <div className="mj-field">
          <div className="field">
            <CenterBoard view={view} me={me} left={left} right={right} />
            {left && <Pond p={left} view={view} side="left" />}
            {right && <Pond p={right} view={view} side="right" />}
            {me && <Pond p={me} view={view} side="bottom" />}
          </div>
        </div>

        {me && you && (
          <section className="mine" aria-label="自分の席">
            {(hasActions || clock?.overtime) && (
              <div className="float-area">
                {clock?.overtime && (
                  <p className="overtime-note">
                    {clock.limit !== null ? `−${clock.limit}秒で` : "時間切れで"}自動ツモ切り＋チップ1枚を卓に供託
                  </p>
                )}
                {hasActions && opts && (
                  <div className="actions">
                    {opts.nuki && (
                      <button type="button" className="act nuki" onClick={() => onAction({ type: "nuki" })}>
                        抜く
                      </button>
                    )}
                    {showRiichiButtons && (
                      <>
                        <button type="button" className="act riichi" onClick={() => startRiichi("normal")}>
                          リーチ
                        </button>
                        <button type="button" className="act riichi" onClick={() => startRiichi("open")}>
                          オープンリーチ
                        </button>
                      </>
                    )}
                    {riichiMode && (
                      <button type="button" className="act ghost" onClick={() => setRiichiMode(null)}>
                        {riichiMode === "open" ? "オープンリーチ取消" : "リーチ取消"}
                      </button>
                    )}
                    {opts.pon && (
                      <button type="button" className="act call" onClick={() => onAction({ type: "pon" })}>
                        ポン
                      </button>
                    )}
                    {opts.kan.map((f) => (
                      <button key={f} type="button" className="act call" onClick={() => onAction({ type: "kan", face: f })}>
                        カン<small>{faceLabel(f)}</small>
                      </button>
                    ))}
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
                    {opts.pass && (
                      <button type="button" className="act ghost" onClick={() => onAction({ type: "pass" })}>
                        パス
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="me-status">
              <div className="me-left">
                {me.isDealer && <span className="dealer-badge">親</span>}
                <RiichiMark p={me} />
                {playing && (
                  <>
                    <span className={`shanten${you.shanten <= 0 ? " ready" : ""}`}>{shantenText(you.shanten)}</span>
                    {you.furiten && <span className="furiten">フリテン</span>}
                    {you.waits.length > 0 && (
                      <span className="waits" aria-label="待ち牌">
                        <span>待ち</span>
                        {you.waits.map((f) => (
                          <Tile key={f} face={f} size="xs" />
                        ))}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="me-right">
                <Flowers p={me} />
                <span className="pchips" title={`チップ（バイイン${me.buyins}回）`}>
                  ◎{me.chips}
                </span>
                {clock && (
                  <span className={`timer${clock.overtime ? " over" : clock.seconds <= 3 ? " hurry" : ""}`} aria-live="polite">
                    {clock.overtime ? `−${clock.seconds}` : clock.seconds}
                    <small>秒</small>
                  </span>
                )}
              </div>
            </div>

            {me.melds.length > 0 && (
              <div className="me-melds">
                <Melds p={me} size="sm" isDora={isDora} />
              </div>
            )}

            <div className={`hand-wrap${riichiMode ? " riichi-mode" : ""}${myTurn ? " my-turn" : ""}`}>
              {selWaits && selWaits.length > 0 && (
                <div className={`sel-waits${selRight ? " right" : ""}`} aria-label="切ったときの待ち">
                  <span>{riichiMode ? "リーチ後の待ち" : "切ると待ち"}</span>
                  {selWaits.map((f) => (
                    <Tile key={f} face={f} size="xs" />
                  ))}
                </div>
              )}
              <div className="hand" role="group" aria-label="手牌">
                {you.hand.map((t, i) => (
                  <button key={i} type="button" className={handTileClass(i, t)} onClick={() => tap(i)} aria-pressed={selected === i}>
                    <Tile tile={t} size="fluid" dora={isDora(t)} />
                  </button>
                ))}
                {you.drawn && (
                  <button type="button" className={handTileClass(-1, you.drawn)} onClick={() => tap(-1)} aria-pressed={selected === -1}>
                    <Tile tile={you.drawn} size="fluid" dora={isDora(you.drawn)} />
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

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
