import { useMemo, useState } from "react";
import { liveGames, useGroup } from "../store";
import { Confirm, Dot, Empty, Name, Sheet, Yen, fmtDateTime, type ConfirmSpec } from "../ui";
import { calcGame, calcTransfers, fmtYen, splitFee, sumIsZero } from "../../shared/mahjong";
import type { Adjustment, AdjustmentKind, ChipEntry, GroupState, Member } from "../../shared/types";
import { downloadCsv, participants, sessionBalances, sessionOf, settledImpact } from "../logic";
import { SettledWarning } from "./GameEditor";

export function SettleView({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
  const [chipOpen, setChipOpen] = useState<{ open: boolean; entry: ChipEntry | null }>({ open: false, entry: null });
  const [adjOpen, setAdjOpen] = useState<{ open: boolean; entry: Adjustment | null }>({ open: false, entry: null });
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const session = sessionOf(state, sid)!;
  const balances = sessionBalances(state, sid);
  const people = participants(state, sid);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const transfers = calcTransfers(balances);
  const settled = new Map(
    state.settlements.filter((x) => x.sessionId === sid && !x.deletedAt).map((x) => [x.memberId, x]),
  );
  const chips = state.chips.filter((c) => c.sessionId === sid && !c.deletedAt);
  const adjs = state.adjustments.filter((a) => a.sessionId === sid && !a.deletedAt);
  const rows = people
    .map((m) => ({ m, b: balances[m.id] }))
    .filter((r) => r.b)
    .sort((a, b) => b.b.total - a.b.total);

  const markSettled = (m: Member) => {
    const total = balances[m.id]?.total ?? 0;
    const mine = transfers.filter((t) => t.from === m.id || t.to === m.id);
    setConfirm({
      title: `${m.name}さんを精算済みにしますか`,
      body: (
        <>
          <p>
            いまの最終収支は <Yen v={total} big /> 円です。
          </p>
          {mine.length > 0 && (
            <ul className="transfers">
              {mine.map((t, i) => (
                <li key={i}>
                  {mm.get(t.from)?.name} → {mm.get(t.to)?.name}　<b className="num">{t.yen.toLocaleString()}円</b>
                </li>
              ))}
            </ul>
          )}
          <p className="note">精算済みにした後に金額が変わる操作をすると、警告が出ます。</p>
        </>
      ),
      okLabel: "精算済みにする",
      onOk: async () => {
        try {
          await api("POST", "/settlements", { sessionId: sid, memberId: m.id, yen: total });
          toast(`${m.name}さんを精算済みにしました`);
          await refresh();
        } catch (e) {
          toast(e instanceof Error ? e.message : "保存できませんでした。");
        }
      },
    });
  };

  const removeEntry = (kind: "chips" | "adjustments", id: string, label: string) => {
    const next: GroupState =
      kind === "chips"
        ? { ...state, chips: state.chips.map((c) => (c.id === id ? { ...c, deletedAt: "x" } : c)) }
        : { ...state, adjustments: state.adjustments.map((c) => (c.id === id ? { ...c, deletedAt: "x" } : c)) };
    setConfirm({
      title: `${label}を削除しますか`,
      body: (
        <>
          <SettledWarning impact={settledImpact(state, next, sid)} state={state} />
          <p>削除した記録は変更履歴から元に戻せます。</p>
        </>
      ),
      okLabel: "削除する",
      danger: true,
      onOk: async () => {
        try {
          await api("POST", `/${kind}/${id}/delete`);
          toast(`${label}を削除しました`);
          await refresh();
        } catch (e) {
          toast(e instanceof Error ? e.message : "削除できませんでした。");
        }
      },
    });
  };

  const exportCsv = () => {
    const games = liveGames(state, sid).sort((a, b) => a.seq - b.seq);
    downloadCsv(`精算_${session.playedOn}.csv`, [
      ["名前", "半荘数", "麻雀収支", "チップ", "調整（外部）", "調整（メンバー間）", "最終収支"],
      ...rows.map(({ m, b }) => [m.name, b.games, b.mahjong, b.chips, b.external, b.internal, b.total]),
      [],
      ["送金", "", ""],
      ...transfers.map((t) => [mm.get(t.from)?.name ?? "", "→", mm.get(t.to)?.name ?? "", t.yen]),
      [],
      ["半荘", "1位", "素点", "円", "2位", "素点", "円", "3位", "素点", "円", "レート"],
      ...games.map((g) => [
        g.seq,
        ...calcGame(g.scores, g.rate).flatMap((r) => [mm.get(r.memberId)?.name ?? "", r.score * 100, r.yen]),
        g.rate,
      ]),
    ]);
  };

  return (
    <>
      {rows.length === 0 ? (
        <Empty>半荘を記録すると精算額が出ます。</Empty>
      ) : (
        <div className="tbl-scroll">
          <table className="tbl settle">
            <thead>
              <tr>
                <th className="sticky">名前</th>
                <th>麻雀</th>
                <th>チップ</th>
                <th>調整</th>
                <th>最終</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, b }) => {
                return (
                  <tr key={m.id}>
                    <td className="sticky">
                      <Name m={m} />
                    </td>
                    <td className="num">{fmtYen(b.mahjong)}</td>
                    <td className="num">{fmtYen(b.chips)}</td>
                    <td className="num">{fmtYen(b.external + b.internal)}</td>
                    <td className="num strong">
                      <Yen v={b.total} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <section className="block">
          <h2>途中精算</h2>
          <p className="note">抜ける人がいたら、その人の金額を確定して「精算済み」にします。</p>
          <ul className="list">
            {rows.map(({ m, b }) => {
              const st = settled.get(m.id);
              const changed = !!st && st.yen !== b.total;
              return (
                <li key={m.id} className="row-between pad">
                  <span className="grow-col">
                    <Name m={m} />
                    {changed && <small className="warn-text">精算後に{fmtYen(b.total - st.yen)}円変わりました</small>}
                  </span>
                  {st && !changed ? (
                    <span className="badge ok">精算済み {fmtYen(st.yen)}円</span>
                  ) : (
                    <button type="button" className="btn small" onClick={() => markSettled(m)}>
                      {changed ? "精算し直す" : "精算済みにする"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {transfers.length > 0 && (
        <section className="block">
          <h2>送金のしかた</h2>
          <ul className="transfers">
            {transfers.map((t, i) => (
              <li key={i}>
                <Name m={mm.get(t.from)} /> が <Name m={mm.get(t.to)} /> に
                <b className="num">{t.yen.toLocaleString()}円</b>
              </li>
            ))}
          </ul>
          <p className="note">麻雀収支・チップ・メンバー間の調整が対象です。店に払う場代などは各自の最終収支に入っています。</p>
        </section>
      )}

      <section className="block">
        <div className="block-head">
          <h2>チップ（1枚 {session.chipYen.toLocaleString()}円）</h2>
          <button type="button" className="btn small" onClick={() => setChipOpen({ open: true, entry: null })}>
            ＋記録
          </button>
        </div>
        {chips.length === 0 && <p className="note">チップの増減は、途中で抜ける人がいるときや最後にまとめて記録します。</p>}
        <ul className="list entries">
          {chips.map((c) => (
            <li key={c.id}>
              <div className="entry">
                <small>
                  {fmtDateTime(c.createdAt)} {c.memo}
                </small>
                <span className="entry-lines">
                  {c.lines.map((l) => (
                    <span key={l.memberId}>
                      <Dot m={mm.get(l.memberId)} />
                      {mm.get(l.memberId)?.name} {l.count > 0 ? "+" : "−"}
                      {Math.abs(l.count)}枚
                    </span>
                  ))}
                </span>
              </div>
              <span className="entry-actions">
                <button type="button" className="btn small ghost" onClick={() => setChipOpen({ open: true, entry: c })}>
                  編集
                </button>
                <button type="button" className="btn small ghost danger" onClick={() => removeEntry("chips", c.id, "チップの記録")}>
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>調整（場代など）</h2>
          <button type="button" className="btn small" onClick={() => setAdjOpen({ open: true, entry: null })}>
            ＋記録
          </button>
        </div>
        {adjs.length === 0 && <p className="note">場代などを、個人の最終収支から直接足し引きします。</p>}
        <ul className="list entries">
          {adjs.map((a) => (
            <li key={a.id}>
              <div className="entry">
                <small>
                  {fmtDateTime(a.createdAt)} {a.kind === "internal" ? "メンバー間" : "外部"}：{a.memo}
                </small>
                <span className="entry-lines">
                  {a.lines.map((l) => (
                    <span key={l.memberId}>
                      <Dot m={mm.get(l.memberId)} />
                      {mm.get(l.memberId)?.name} {fmtYen(l.yen)}円
                    </span>
                  ))}
                </span>
              </div>
              <span className="entry-actions">
                <button type="button" className="btn small ghost" onClick={() => setAdjOpen({ open: true, entry: a })}>
                  編集
                </button>
                <button type="button" className="btn small ghost danger" onClick={() => removeEntry("adjustments", a.id, "調整")}>
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button type="button" className="btn ghost wide" onClick={exportCsv}>
        精算をCSVで保存
      </button>

      <ChipSheet sid={sid} open={chipOpen.open} entry={chipOpen.entry} onClose={() => setChipOpen({ open: false, entry: null })} />
      <AdjSheet sid={sid} open={adjOpen.open} entry={adjOpen.entry} onClose={() => setAdjOpen({ open: false, entry: null })} />
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function usePeople(sid: string, showAll: boolean, extra: string[]) {
  const { state } = useGroup();
  return useMemo(() => {
    if (!state) return [];
    const p = participants(state, sid);
    const ids = new Set([...p.map((m) => m.id), ...extra]);
    return state.members.filter((m) => ids.has(m.id) || (showAll && !m.hidden));
  }, [state, sid, showAll, extra.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ChipSheet({ sid, open, entry, onClose }: { sid: string; open: boolean; entry: ChipEntry | null; onClose: () => void }) {
  const { state, api, refresh, toast } = useGroup();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memo, setMemo] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setCounts(Object.fromEntries(entry?.lines.map((l) => [l.memberId, l.count]) ?? []));
      setMemo(entry?.memo ?? "");
      setShowAll(false);
    }
  }
  const people = usePeople(sid, showAll, entry?.lines.map((l) => l.memberId) ?? []);
  if (!state) return null;
  const session = sessionOf(state, sid)!;
  const values = Object.values(counts);
  const sum = values.reduce((a, v) => a + v, 0);
  const lines = Object.entries(counts)
    .filter(([, v]) => v !== 0)
    .map(([memberId, count]) => ({ memberId, count }));
  const ok = lines.length >= 2 && sumIsZero(values);

  const save = async () => {
    const draft: ChipEntry = entry
      ? { ...entry, lines, memo }
      : { id: "draft", sessionId: sid, lines, memo, createdAt: "", deletedAt: null };
    const next: GroupState = entry
      ? { ...state, chips: state.chips.map((c) => (c.id === entry.id ? draft : c)) }
      : { ...state, chips: [...state.chips, draft] };
    const impact = settledImpact(state, next, sid);
    const run = async () => {
      try {
        if (entry) await api("PATCH", `/chips/${entry.id}`, { lines, memo });
        else await api("POST", "/chips", { sessionId: sid, lines, memo });
        onClose();
        toast("チップを記録しました");
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "保存できませんでした。");
      }
    };
    if (impact.length) {
      setConfirm({ title: "精算済みの人がいます", body: <SettledWarning impact={impact} state={state} />, okLabel: "保存する", onOk: run });
    } else await run();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? "チップの記録を編集" : "チップを記録"}
        footer={
          <button type="button" className="btn primary wide" disabled={!ok} onClick={() => void save()}>
            保存する
          </button>
        }
      >
        <p className="note">増えた枚数を＋、減った枚数を−で入れます。合計が0になると保存できます。</p>
        <ul className="steppers">
          {people.map((m) => {
            const v = counts[m.id] ?? 0;
            return (
              <li key={m.id}>
                <Name m={m} />
                <span className="stepper">
                  <button type="button" onClick={() => setCounts((c) => ({ ...c, [m.id]: v - 1 }))} aria-label={`${m.name}を1枚減らす`}>
                    −
                  </button>
                  <output className={`num ${v > 0 ? "plus" : v < 0 ? "minus" : ""}`}>{v > 0 ? `+${v}` : v}</output>
                  <button type="button" onClick={() => setCounts((c) => ({ ...c, [m.id]: v + 1 }))} aria-label={`${m.name}を1枚増やす`}>
                    ＋
                  </button>
                </span>
                <small className="num">{fmtYen(v * session.chipYen)}円</small>
              </li>
            );
          })}
        </ul>
        {!showAll && (
          <button type="button" className="btn small ghost" onClick={() => setShowAll(true)}>
            ほかのメンバーも表示
          </button>
        )}
        <p className={`total ${sum === 0 ? "good" : "bad"}`}>{sum === 0 ? "合計 0枚" : `合計 ${sum > 0 ? "+" : ""}${sum}枚（0にしてください）`}</p>
        <label className="form">
          メモ（任意）
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="例：ドナーが抜けるので精算" />
        </label>
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function AdjSheet({ sid, open, entry, onClose }: { sid: string; open: boolean; entry: Adjustment | null; onClose: () => void }) {
  const { state, api, refresh, toast } = useGroup();
  const [kind, setKind] = useState<AdjustmentKind>("external");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [fee, setFee] = useState({ amount: "", mode: "equal" as "equal" | "single" | "games", single: "" });
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setKind(entry?.kind ?? "external");
      setVals(Object.fromEntries(entry?.lines.map((l) => [l.memberId, String(l.yen)]) ?? []));
      setMemo(entry?.memo ?? "");
      setShowAll(false);
      setFee({ amount: "", mode: "equal", single: "" });
    }
  }
  const people = usePeople(sid, showAll, entry?.lines.map((l) => l.memberId) ?? []);
  if (!state) return null;
  const balances = sessionBalances(state, sid);
  const lines = Object.entries(vals)
    .map(([memberId, v]) => ({ memberId, yen: Number(v.replace(/[^\d-]/g, "")) }))
    .filter((l) => Number.isInteger(l.yen) && l.yen !== 0);
  const sum = lines.reduce((a, l) => a + l.yen, 0);
  const ok = lines.length > 0 && memo.trim() !== "" && (kind === "external" || sum === 0);

  const applyFee = () => {
    const amount = Number(fee.amount);
    if (!Number.isInteger(amount) || amount <= 0) return toast("金額を円の整数で入れてください。");
    let payers: { memberId: string; weight: number }[] = [];
    if (fee.mode === "single") {
      if (!fee.single) return toast("払う人を選んでください。");
      payers = [{ memberId: fee.single, weight: 1 }];
    } else if (fee.mode === "games") payers = people.map((m) => ({ memberId: m.id, weight: balances[m.id]?.games ?? 0 }));
    else payers = people.map((m) => ({ memberId: m.id, weight: 1 }));
    const r = splitFee(amount, payers);
    if (!r.length) return toast("割り振る相手がいません。");
    setKind("external");
    setVals(Object.fromEntries(r.map((x) => [x.memberId, String(x.yen)])));
    if (!memo) setMemo(`場代 ${amount.toLocaleString()}円`);
  };

  const save = async () => {
    const draft: Adjustment = entry
      ? { ...entry, kind, lines, memo }
      : { id: "draft", sessionId: sid, kind, lines, memo, createdAt: "", deletedAt: null };
    const next: GroupState = entry
      ? { ...state, adjustments: state.adjustments.map((c) => (c.id === entry.id ? draft : c)) }
      : { ...state, adjustments: [...state.adjustments, draft] };
    const impact = settledImpact(state, next, sid);
    const run = async () => {
      try {
        if (entry) await api("PATCH", `/adjustments/${entry.id}`, { kind, lines, memo });
        else await api("POST", "/adjustments", { sessionId: sid, kind, lines, memo });
        onClose();
        toast("調整を記録しました");
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "保存できませんでした。");
      }
    };
    if (impact.length) {
      setConfirm({ title: "精算済みの人がいます", body: <SettledWarning impact={impact} state={state} />, okLabel: "保存する", onOk: run });
    } else await run();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? "調整を編集" : "調整を記録"}
        footer={
          <button type="button" className="btn primary wide" disabled={!ok} onClick={() => void save()}>
            保存する
          </button>
        }
      >
        <div className="seg">
          <button type="button" className={kind === "external" ? "on" : ""} onClick={() => setKind("external")}>
            外部（店など）
          </button>
          <button type="button" className={kind === "internal" ? "on" : ""} onClick={() => setKind("internal")}>
            メンバー間
          </button>
        </div>
        <p className="note">
          {kind === "external"
            ? "店に払う場代など。各自の最終収支から差し引き、送金の計算には入れません。"
            : "立て替えなど。合計0円になるように入れます。送金の計算に入ります。"}
        </p>

        {kind === "external" && !entry && (
          <details className="fee">
            <summary>場代を割り振る</summary>
            <div className="form">
              <label>
                金額（円）
                <input inputMode="numeric" value={fee.amount} onChange={(e) => setFee({ ...fee, amount: e.target.value.replace(/\D/g, "") })} />
              </label>
              <div className="seg">
                {(
                  [
                    ["equal", "全員で均等"],
                    ["games", "半荘数に応じて"],
                    ["single", "1人が払う"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" className={fee.mode === k ? "on" : ""} onClick={() => setFee({ ...fee, mode: k })}>
                    {l}
                  </button>
                ))}
              </div>
              {fee.mode === "single" && (
                <select value={fee.single} onChange={(e) => setFee({ ...fee, single: e.target.value })}>
                  <option value="">払う人を選ぶ</option>
                  {people.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn" onClick={applyFee}>
                下の欄に入れる
              </button>
            </div>
          </details>
        )}

        <ul className="steppers">
          {people.map((m) => (
            <li key={m.id}>
              <Name m={m} />
              <input
                className="yen-input"
                inputMode="numeric"
                value={vals[m.id] ?? ""}
                placeholder="0"
                onChange={(e) => setVals((v) => ({ ...v, [m.id]: e.target.value.replace(/[^\d-]/g, "") }))}
                aria-label={`${m.name}の金額（円）`}
              />
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  setVals((v) => {
                    const cur = v[m.id] ?? "";
                    return { ...v, [m.id]: cur.startsWith("-") ? cur.slice(1) : `-${cur}` };
                  })
                }
              >
                ±
              </button>
            </li>
          ))}
        </ul>
        {!showAll && (
          <button type="button" className="btn small ghost" onClick={() => setShowAll(true)}>
            ほかのメンバーも表示
          </button>
        )}
        {kind === "internal" && (
          <p className={`total ${sum === 0 ? "good" : "bad"}`}>{sum === 0 ? "合計 0円" : `合計 ${fmtYen(sum)}円（0にしてください）`}</p>
        )}
        <label className="form">
          メモ（必須）
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={100} placeholder="例：場代 1位が負担" />
        </label>
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
