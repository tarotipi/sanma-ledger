import { useEffect, useMemo, useState } from "react";
import { useGroup, liveGames } from "../store";
import { Confirm, Dot, Name, Sheet, Yen, type ConfirmSpec } from "../ui";
import { RULES, calcGame, fmtPt, fmtScore, tieGroups, validateGame } from "../../shared/mahjong";
import type { Game, GroupState, Score } from "../../shared/types";
import { settledImpact } from "../logic";
import { uploadPhoto } from "./Photos";

type Slot = { memberId: string; text: string; neg: boolean; auto: boolean };

function slotScore(s: Slot): number | null {
  if (s.text === "") return null;
  const n = Number(s.text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return s.neg ? -n : n;
}

/** W-01 の確認内容：変更前後の各人の円 */
export function DiffTable({
  state,
  before,
  after,
  rate,
}: {
  state: GroupState;
  before: Score[] | null;
  after: Score[] | null;
  rate: number;
}) {
  const b = before ? calcGame(before, rate) : [];
  const a = after ? calcGame(after, rate) : [];
  const ids = [...new Set([...b, ...a].map((x) => x.memberId))];
  const m = new Map(state.members.map((x) => [x.id, x]));
  return (
    <table className="tbl diff">
      <thead>
        <tr>
          <th>名前</th>
          <th>素点</th>
          <th>円</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => {
          const x = b.find((r) => r.memberId === id);
          const y = a.find((r) => r.memberId === id);
          return (
            <tr key={id}>
              <td>
                <Name m={m.get(id)} />
              </td>
              <td className="num">
                {x ? fmtScore(x.score) : "—"} → {y ? fmtScore(y.score) : "—"}
              </td>
              <td className="num">
                <Yen v={(y?.yen ?? 0) - (x?.yen ?? 0)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function isFreeEdit(state: GroupState, game: Game): boolean {
  const newer = liveGames(state, game.sessionId).filter((g) => g.seq > game.seq).length;
  return newer < RULES.FREE_EDIT_LATEST;
}

export function SettledWarning({ impact, state }: { impact: ReturnType<typeof settledImpact>; state: GroupState }) {
  if (!impact.length) return null;
  const m = new Map(state.members.map((x) => [x.id, x]));
  return (
    <div className="warn">
      <strong>精算済みの人の金額が変わります</strong>
      <ul>
        {impact.map((i) => (
          <li key={i.memberId}>
            {m.get(i.memberId)?.name}：精算時 {i.recorded.toLocaleString()}円 → {i.next.toLocaleString()}円
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GameEditor({
  open,
  onClose,
  sessionId,
  game,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  game: Game | null;
}) {
  const { state, api, refresh, patchState, toast } = useGroup();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [ties, setTies] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const session = state?.sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (!open || !state) return;
    setFiles([]);
    if (game) {
      setSlots(game.scores.map((s) => ({ memberId: s.memberId, text: String(Math.abs(s.score)), neg: s.score < 0, auto: false })));
      const t: Record<string, number> = {};
      game.scores.forEach((s) => {
        if (s.tie !== undefined) t[s.memberId] = s.tie;
      });
      setTies(t);
    } else {
      const prev = liveGames(state, sessionId).sort((a, b) => b.seq - a.seq)[0];
      setSlots((prev?.scores ?? []).map((s) => ({ memberId: s.memberId, text: "", neg: false, auto: false })));
      setTies({});
    }
  }, [open, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scores: Score[] | null = useMemo(() => {
    if (slots.length !== 3) return null;
    const out: Score[] = [];
    for (const s of slots) {
      const v = slotScore(s);
      if (v === null) return null;
      const sc: Score = { memberId: s.memberId, score: v };
      if (ties[s.memberId] !== undefined) sc.tie = ties[s.memberId];
      out.push(sc);
    }
    return out;
  }, [slots, ties]);

  if (!state || !session) return null;
  const members = state.members.filter((m) => !m.hidden || slots.some((s) => s.memberId === m.id));
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const filled = slots.map(slotScore);
  const sum = filled.reduce<number>((a, v) => a + (v ?? 0), 0);
  const allFilled = slots.length === 3 && filled.every((v) => v !== null);
  const validation = scores ? validateGame(scores) : null;
  const rate = game?.rate ?? session.rate;
  const results = scores && validation?.ok ? calcGame(scores, rate) : null;
  const groupsTied = scores ? tieGroups(scores) : [];

  const toggleMember = (id: string) => {
    setTies({});
    setSlots((cur) => {
      if (cur.some((s) => s.memberId === id)) return cur.filter((s) => s.memberId !== id);
      if (cur.length >= 3) return cur;
      return [...cur, { memberId: id, text: "", neg: false, auto: false }];
    });
  };

  const setSlot = (i: number, patch: Partial<Slot>) => {
    setTies({});
    setSlots((cur) => {
      const next = cur.map((s, j) => (j === i ? { ...s, ...patch, auto: false } : s));
      // 2人入れたら残りの1人を自動で埋める
      const empties = next.map((s, j) => (s.text === "" || s.auto ? j : -1)).filter((j) => j >= 0);
      if (next.length === 3 && empties.length === 1) {
        const k = empties[0];
        const others = next.filter((_, j) => j !== k).map(slotScore);
        if (others.every((v) => v !== null)) {
          const rest = RULES.TOTAL - (others as number[]).reduce((a, v) => a + v, 0);
          next[k] = { ...next[k], text: String(Math.abs(rest)), neg: rest < 0, auto: true };
        }
      }
      return next;
    });
  };

  const save = async () => {
    if (!scores || !validation?.ok) return;
    const after: Game = game
      ? { ...game, scores, updatedAt: new Date().toISOString() }
      : {
          id: `tmp-${Date.now()}`,
          sessionId,
          seq: Math.max(0, ...liveGames(state, sessionId).map((g) => g.seq)) + 1,
          rate: session.rate,
          scores,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        };
    const nextState: GroupState = game
      ? { ...state, games: state.games.map((g) => (g.id === game.id ? after : g)) }
      : { ...state, games: [...state.games, after] };
    const impact = settledImpact(state, nextState, sessionId);

    const run = async () => {
      const pendingFiles = files;
      patchState(() => nextState);
      onClose();
      try {
        const saved = game
          ? await api<Game>("PATCH", `/games/${game.id}`, { scores })
          : await api<Game>("POST", "/games", { sessionId, scores });
        patchState((s) => ({ ...s, games: s.games.map((g) => (g.id === after.id ? saved : g)) }));
        toast(game ? `第${saved.seq}半荘を変更しました` : `第${saved.seq}半荘を記録しました`);
        for (const f of pendingFiles) await uploadPhoto(api, f, sessionId, saved.id);
      } catch (e) {
        toast(e instanceof Error ? e.message : "保存できませんでした。");
      } finally {
        await refresh();
      }
    };

    const needW01 = game && !isFreeEdit(state, game);
    if (needW01 || impact.length) {
      setConfirm({
        title: needW01 ? `第${game!.seq}半荘を変更しますか` : "精算済みの人がいます",
        body: (
          <>
            {needW01 && <p>最新ではない半荘です。変更すると次のように金額が変わります。</p>}
            <DiffTable state={state} before={game?.scores ?? null} after={scores} rate={rate} />
            <SettledWarning impact={impact} state={state} />
          </>
        ),
        okLabel: game ? "変更する" : "記録する",
        onOk: run,
      });
      return;
    }
    await run();
  };

  const totalMsg = !allFilled
    ? `合計 ${fmtScore(sum)}点`
    : sum === RULES.TOTAL
      ? "合計 105,000点"
      : sum > RULES.TOTAL
        ? `${fmtScore(sum - RULES.TOTAL)}点 多い`
        : `あと ${fmtScore(RULES.TOTAL - sum)}点`;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={game ? `第${game.seq}半荘を編集` : "半荘を記録"}
        footer={
          <button type="button" className="btn primary wide" disabled={!validation?.ok} onClick={() => void save()}>
            {game ? "変更を保存" : "記録する"}
          </button>
        }
      >
        <section className="editor">
          <h3>打った3人 {slots.length}/3</h3>
          <div className="chips">
            {members.map((m) => {
              const on = slots.some((s) => s.memberId === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  disabled={!on && slots.length >= 3}
                  onClick={() => toggleMember(m.id)}
                >
                  <Dot m={m} />
                  {m.name}
                </button>
              );
            })}
          </div>

          {slots.length === 3 && (
            <>
              <h3>素点（百点単位）</h3>
              <div className="score-inputs">
                {slots.map((s, i) => (
                  <div key={s.memberId} className={`score-input ${s.auto ? "auto" : ""}`}>
                    <Name m={mm.get(s.memberId)} />
                    <button
                      type="button"
                      className={`sign ${s.neg ? "neg" : ""}`}
                      onClick={() => setSlot(i, { neg: !s.neg, text: s.text })}
                      aria-label="マイナスにする"
                    >
                      {s.neg ? "−" : "+"}
                    </button>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={s.text}
                      onChange={(e) => setSlot(i, { text: e.target.value.replace(/[^0-9]/g, "").slice(0, 5) })}
                      placeholder="320"
                      aria-label={`${mm.get(s.memberId)?.name}の素点（百点単位）`}
                    />
                    <span className="unit">00点</span>
                  </div>
                ))}
              </div>
              <p className={`total ${allFilled && sum !== RULES.TOTAL ? "bad" : allFilled ? "good" : ""}`}>{totalMsg}</p>

              {groupsTied.length > 0 && (
                <div className="ties">
                  <h3>同点です。上の順位にする人から順に押してください</h3>
                  {groupsTied.map((g) => (
                    <div key={g[0].score} className="chips">
                      {[...g]
                        .sort((a, b) => (ties[a.memberId] ?? 99) - (ties[b.memberId] ?? 99))
                        .map((s) => (
                          <button
                            key={s.memberId}
                            type="button"
                            className={`chip ${ties[s.memberId] !== undefined ? "on" : ""}`}
                            onClick={() =>
                              setTies((t) => {
                                if (t[s.memberId] !== undefined) return t;
                                const used = g.filter((x) => t[x.memberId] !== undefined).length;
                                return { ...t, [s.memberId]: used + 1 };
                              })
                            }
                          >
                            {ties[s.memberId] !== undefined && <b>{ties[s.memberId]}</b>}
                            {mm.get(s.memberId)?.name}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          setTies((t) => {
                            const n = { ...t };
                            g.forEach((x) => delete n[x.memberId]);
                            return n;
                          })
                        }
                      >
                        選び直す
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {results && (
                <table className="tbl result">
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.memberId}>
                        <td className={`rank r${r.rank}`}>{r.rank}</td>
                        <td>
                          <Name m={mm.get(r.memberId)} />
                        </td>
                        <td className="num">{fmtPt(r.pt10)}</td>
                        <td className="num">
                          <Yen v={r.yen} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {!game && (
                <label className="file-pick">
                  <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
                  {files.length ? `写真 ${files.length}枚を一緒に保存` : "写真を付ける（任意）"}
                </label>
              )}
            </>
          )}
        </section>
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
