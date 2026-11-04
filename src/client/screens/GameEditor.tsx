import { useEffect, useMemo, useRef, useState } from "react";
import { useGroup, liveGames } from "../store";
import { Confirm, Dot, Name, Sheet, Yen, type ConfirmSpec } from "../ui";
import { RULES, calcGame, fmtPt, fmtScore, suggestNext, tieGroups, validateGame } from "../../shared/mahjong";
import type { Game, GroupState, Member, Score } from "../../shared/types";
import { settledImpact } from "../logic";
import { newId } from "../api";
import { addYakuman, discardHeld, releaseHeld } from "../outbox";
import { PhotoField, YakuFields, YakuNames, useAddPhoto, usePhotoInputs } from "./YakumanParts";

type Slot = { memberId: string; text: string; neg: boolean; auto: boolean };
/** 入力中の役満1件。id はそのまま役満の行のIDになる */
type YakuRow = { id: string; memberId: string; name: string };

/** 入力の途中経過。カメラから戻ったときにアプリが再読み込みされても、続きから入力できるように残す */
type EditorDraft = {
  gameId: string | null;
  clientId: string;
  slots: Slot[];
  ties: Record<string, number>;
  rows: YakuRow[];
  /** true なら、再読み込み後に記録の画面を開き直す */
  resume: boolean;
};

const editorDraftKey = (gid: string, sid: string) => `sanma.editor.${gid}.${sid}`;

export function loadEditorDraft(gid: string, sid: string): EditorDraft | null {
  try {
    return JSON.parse(localStorage.getItem(editorDraftKey(gid, sid)) ?? "null") as EditorDraft | null;
  } catch {
    return null;
  }
}

function saveEditorDraft(gid: string, sid: string, d: EditorDraft | null): void {
  try {
    if (d) localStorage.setItem(editorDraftKey(gid, sid), JSON.stringify(d));
    else localStorage.removeItem(editorDraftKey(gid, sid));
  } catch {
    /* 保存できない環境でも動作は続ける */
  }
}

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
  const { state, gid, api, refresh, toast, admin, adminPw, flush } = useGroup();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [ties, setTies] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [rows, setRows] = useState<YakuRow[]>([]);
  const [saving, setSaving] = useState(false);
  // 同じ入力を送り直しても二重にならないように、開くたびにIDを1つ決めておく
  const clientId = useRef(newId());
  const resume = useRef(false);
  const session = state?.sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    if (!open || !state) return;
    setHint(null);
    setSaving(false);
    const draft = loadEditorDraft(gid, sessionId);
    if (draft && draft.resume && draft.gameId === (game?.id ?? null)) {
      clientId.current = draft.clientId;
      resume.current = false;
      setSlots(draft.slots);
      setTies(draft.ties);
      setRows(draft.rows);
      return;
    }
    clientId.current = newId();
    setRows([]);
    if (game) {
      setSlots(game.scores.map((s) => ({ memberId: s.memberId, text: String(Math.abs(s.score)), neg: s.score < 0, auto: false })));
      const t: Record<string, number> = {};
      game.scores.forEach((s) => {
        if (s.tie !== undefined) t[s.memberId] = s.tie;
      });
      setTies(t);
    } else {
      // 抜け番の順番を読み取って、次の3人を最初から選んでおく
      const live = liveGames(state, sessionId);
      const left = new Set(state.settlements.filter((x) => x.sessionId === sessionId && !x.deletedAt).map((x) => x.memberId));
      const sug = suggestNext(live, state.members.map((m) => m.id), left);
      const visible = state.members.filter((m) => !m.hidden);
      // 提案があればそれを、なくてメンバーがちょうど3人ならその3人を最初から選ぶ
      const ids = sug?.players ?? (visible.length === 3 ? visible.map((m) => m.id) : []);
      setSlots(ids.map((id) => ({ memberId: id, text: "", neg: false, auto: false })));
      if (sug?.sitOut.length) {
        const names = sug.sitOut.map((id) => state.members.find((m) => m.id === id)?.name).join("・");
        setHint(`次の抜け番は ${names}（これまでの順番から）`);
      }
      setTies({});
    }
  }, [open, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // カメラを開く前の入力を残す
  const keepDraft = (nextResume: boolean) => {
    resume.current = nextResume;
    saveEditorDraft(gid, sessionId, { gameId: game?.id ?? null, clientId: clientId.current, slots, ties, rows, resume: nextResume });
  };
  useEffect(() => {
    if (open && resume.current) keepDraft(true);
  }, [open, slots, ties, rows]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (cur.some((s) => s.memberId === id)) {
        // 卓から外した人の役満は残さない（出した人を選び直してもらう）
        setRows((rs) => rs.map((r) => (r.memberId === id ? { ...r, memberId: "" } : r)));
        return cur.filter((s) => s.memberId !== id);
      }
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

    const pendingRows = rows.filter((r) => r.memberId);
    const run = async () => {
      setSaving(true);
      try {
        const saved =
          game && admin
            ? await api<Game>("POST", `/admin/games/${game.id}`, { password: adminPw, scores }) // 記録係の訂正
            : game
              ? await api<Game>("PATCH", `/games/${game.id}`, { scores })
              : await api<Game>("POST", "/games", { sessionId, scores, clientId: clientId.current });
        // 役満は送信待ちに入れる。電波が悪くても、届くまで端末に残して送り直す
        for (const r of pendingRows) {
          await addYakuman({ id: r.id, gid, sessionId, gameId: saved.id, memberId: r.memberId, name: r.name.trim() });
        }
        await releaseHeld(gid, pendingRows.map((r) => r.id));
        saveEditorDraft(gid, sessionId, null);
        resume.current = false;
        setRows([]);
        onClose();
        toast(game ? (admin ? "訂正しました" : `第${saved.seq}半荘を変更しました`) : `第${saved.seq}半荘を記録しました`);
        await refresh();
        await flush();
      } catch (e) {
        // 入力は消さずに画面を開いたままにする。もう一度押しても二重にならない
        toast(e instanceof Error ? e.message : "保存できませんでした。");
      } finally {
        setSaving(false);
      }
    };

    // 管理者モードなら確認画面を飛ばして保存（変更はこれまでどおり履歴に残る）
    const needW01 = game && !isFreeEdit(state, game);
    if (!admin && (needW01 || impact.length)) {
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
        onClose={() => {
          // 取り消されたので、入力中の写真と途中経過を捨てる
          void discardHeld(gid, rows.map((r) => r.id));
          saveEditorDraft(gid, sessionId, null);
          resume.current = false;
          onClose();
        }}
        title={game ? `第${game.seq}半荘を編集` : "半荘を記録"}
        footer={
          <button
            type="button"
            className="btn primary wide"
            disabled={!validation?.ok || saving || rows.some((r) => !r.memberId)}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : game ? "変更を保存" : "記録する"}
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
          {hint && <p className="note">{hint}</p>}

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

              <div className="yaku">
                {rows.map((r, i) => (
                  <YakuRowEditor
                    key={r.id}
                    row={r}
                    index={i + 1}
                    members={slots.map((x) => mm.get(x.memberId))}
                    sessionId={sessionId}
                    beforeCamera={() => keepDraft(true)}
                    onChange={(p) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...p } : x)))}
                    onRemove={() => {
                      void discardHeld(gid, [r.id]);
                      setRows((rs) => rs.filter((x) => x.id !== r.id));
                    }}
                  />
                ))}
                <button
                  type="button"
                  className={`chip yaku-btn ${rows.length ? "" : "first"}`}
                  onClick={() => setRows((rs) => [...rs, { id: newId(), memberId: "", name: "" }])}
                >
                  {rows.length ? "もう1件追加" : "役満が出た"}
                </button>
                {rows.some((r) => !r.memberId) && <p className="note">役満を出した人を選んでください。</p>}
                <YakuNames />
              </div>
            </>
          )}
        </section>
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function YakuRowEditor({
  row,
  index,
  members,
  sessionId,
  beforeCamera,
  onChange,
  onRemove,
}: {
  row: YakuRow;
  index: number;
  members: (Member | undefined)[];
  sessionId: string;
  beforeCamera: () => void;
  onChange: (p: Partial<YakuRow>) => void;
  onRemove: () => void;
}) {
  const addPhoto = useAddPhoto();
  const { inputs, openCamera, openAlbum } = usePhotoInputs(async (f) => {
    await addPhoto(f, { sessionId, yakumanId: row.id, hold: true });
  });
  return (
    <div className="yaku-body">
      <div className="row-between">
        <b>役満 {index}件目</b>
        <button type="button" className="btn small ghost danger" onClick={onRemove}>
          やめる
        </button>
      </div>
      <YakuFields members={members} memberId={row.memberId} name={row.name} onChange={onChange} />
      <PhotoField sessionId={sessionId} yakumanId={row.id} inputs={inputs} beforeCamera={beforeCamera} openCamera={openCamera} openAlbum={openAlbum} />
    </div>
  );
}
