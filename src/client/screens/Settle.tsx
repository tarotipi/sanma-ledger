import { useMemo, useState } from "react";
import { liveGames, useGroup } from "../store";
import { Confirm, Dot, Empty, Name, Sheet, Yen, fmtDateTime, type ConfirmSpec } from "../ui";
import { calcGame, calcTransfers, fmtYen, splitFee } from "../../shared/mahjong";
import type { Adjustment, AdjustmentKind, GroupState, Member } from "../../shared/types";
import { downloadCsv, participants, sessionBalances, sessionOf, settledImpact } from "../logic";
import { SettledWarning } from "./GameEditor";

export function SettleView({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
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

  const removeEntry = (kind: "adjustments", id: string, label: string) => {
    const next: GroupState = { ...state, adjustments: state.adjustments.map((c) => (c.id === id ? { ...c, deletedAt: "x" } : c)) };
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

      <ChipSection sid={sid} />

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

function ChipSection({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const session = sessionOf(state, sid)!;
  const price = session.chipYen;
  const balances = sessionBalances(state, sid);
  const people = participants(state, sid).filter((m) => !m.hidden || balances[m.id]);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const events = state.chipEvents
    .filter((e) => e.sessionId === sid && !e.deletedAt && e.kind !== "count")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const buyers = people.filter((m) => (balances[m.id]?.chipBuy ?? 0) > 0 || balances[m.id]?.chipCount != null);
  const missing = buyers.filter((m) => balances[m.id]?.chipCount == null);
  const counted = buyers.reduce((a, m) => a + (balances[m.id]?.chipCount ?? 0) * price, 0);
  const net = buyers.reduce((a, m) => a + (balances[m.id]?.chipBuy ?? 0) - (balances[m.id]?.chipReturn ?? 0), 0);

  const saveCount = async (memberId: string, text: string) => {
    if (text === "") return;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0) return toast("枚数は0以上の整数で入れてください。");
    if (balances[memberId]?.chipCount === n) return;
    try {
      await api("POST", "/chip-events", { sessionId: sid, memberIds: [memberId], kind: "count", amount: n });
      toast(`${mm.get(memberId)?.name}さんの枚数を${n}枚にしました`);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした。");
    }
  };

  return (
    <section className="block">
      <div className="block-head">
        <h2>チップ（1枚 {price.toLocaleString()}円）</h2>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>
          ＋バイイン・返却
        </button>
      </div>
      {buyers.length === 0 ? (
        <p className="note">チップを買ったら「＋バイイン・返却」で記録します。最後（または途中で抜けるとき）に手持ちの枚数を入れると、チップの収支が出ます。</p>
      ) : (
        <>
          <div className="tbl-scroll">
            <table className="tbl chips-tbl">
              <thead>
                <tr>
                  <th className="sticky">名前</th>
                  <th>購入</th>
                  <th>返却</th>
                  <th>枚数</th>
                  <th>収支</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((m) => {
                  const b = balances[m.id];
                  const cur = counts[m.id] ?? (b.chipCount == null ? "" : String(b.chipCount));
                  return (
                    <tr key={m.id}>
                      <td className="sticky">
                        <Name m={m} />
                      </td>
                      <td className="num">{b.chipBuy ? `−${b.chipBuy.toLocaleString()}` : "—"}</td>
                      <td className="num">{b.chipReturn ? `+${b.chipReturn.toLocaleString()}` : "—"}</td>
                      <td>
                        <input
                          className="count-input"
                          inputMode="numeric"
                          value={cur}
                          placeholder="未入力"
                          aria-label={`${m.name}の手持ち枚数`}
                          onChange={(e) => setCounts((c) => ({ ...c, [m.id]: e.target.value.replace(/\D/g, "") }))}
                          onBlur={() => void saveCount(m.id, cur)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>
                      <td className="num">{b.chipCount == null ? "—" : <Yen v={b.chips} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {missing.length > 0 ? (
            <p className="note">枚数が未入力：{missing.map((m) => m.name).join("、")}（未入力の人は0枚として計算しています）</p>
          ) : counted !== net ? (
            <div className="warn">
              <strong>チップの合計が合いません</strong>
              <p>
                数えた枚数は合計 {(counted / price).toLocaleString()}枚（{counted.toLocaleString()}円分）、購入−返却は {net.toLocaleString()}円分です。
                {fmtYen(counted - net)}円分ずれています。枚数か購入額を確認してください。
              </p>
            </div>
          ) : (
            <p className="note good-text">チップの合計は合っています。</p>
          )}
        </>
      )}
      {events.length > 0 && (
        <ul className="list entries">
          {events.map((e) => (
            <li key={e.id}>
              <div className="entry">
                <small>{fmtDateTime(e.createdAt)}</small>
                <span className="entry-lines">
                  <span>
                    <Dot m={mm.get(e.memberId)} />
                    {mm.get(e.memberId)?.name}　{e.kind === "buy" ? "バイイン" : "返却"} {e.amount.toLocaleString()}円（{Math.round(e.amount / price)}枚）
                  </span>
                </span>
              </div>
              <span className="entry-actions">
                <button
                  type="button"
                  className="btn small ghost danger"
                  onClick={() =>
                    setConfirm({
                      title: "この記録を削除しますか",
                      body: <p>削除した記録は履歴から元に戻せます。</p>,
                      okLabel: "削除する",
                      danger: true,
                      onOk: async () => {
                        try {
                          await api("POST", `/chip_events/${e.id}/delete`);
                          toast("削除しました");
                          await refresh();
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "削除できませんでした。");
                        }
                      },
                    })
                  }
                >
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <BuySheet sid={sid} open={open} onClose={() => setOpen(false)} />
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}

function BuySheet({ sid, open, onClose }: { sid: string; open: boolean; onClose: () => void }) {
  const { state, api, refresh, toast } = useGroup();
  const [kind, setKind] = useState<"buy" | "return">("buy");
  const [who, setWho] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setKind("buy");
      setWho([]);
      setShowAll(false);
      const last = state?.chipEvents.filter((e) => e.sessionId === sid && e.kind === "buy" && !e.deletedAt).at(-1);
      setAmount(last ? String(last.amount) : "");
    }
  }
  const people = usePeople(sid, showAll, []);
  if (!state) return null;
  const price = sessionOf(state, sid)!.chipYen;
  const yen = Number(amount);
  const ok = who.length > 0 && Number.isInteger(yen) && yen > 0;
  const presets = [10, 20, 30, 50].map((n) => n * price);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={kind === "buy" ? "バイインを記録" : "返却を記録"}
      footer={
        <button
          type="button"
          className="btn primary wide"
          disabled={!ok}
          onClick={async () => {
            try {
              await api("POST", "/chip-events", { sessionId: sid, memberIds: who, kind, amount: yen });
              onClose();
              toast(kind === "buy" ? "バイインを記録しました" : "返却を記録しました");
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : "保存できませんでした。");
            }
          }}
        >
          記録する
        </button>
      }
    >
      <div className="seg">
        <button type="button" className={kind === "buy" ? "on" : ""} onClick={() => setKind("buy")}>
          バイイン（買う）
        </button>
        <button type="button" className={kind === "return" ? "on" : ""} onClick={() => setKind("return")}>
          返却（返す）
        </button>
      </div>
      <p className="note">
        {kind === "buy"
          ? "チップを買った人を選びます。最初に配る分もバイインとして記録します。複数人を選ぶと、全員に同じ額が入ります。"
          : "増えすぎたチップを返した人を選びます。返した額だけ、その人の借りが減ります。"}
      </p>
      <div className="chips">
        {people.map((m) => {
          const on = who.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`chip ${on ? "on" : ""}`}
              aria-pressed={on}
              onClick={() => setWho((w) => (on ? w.filter((x) => x !== m.id) : [...w, m.id]))}
            >
              <Dot m={m} />
              {m.name}
            </button>
          );
        })}
        {!showAll && (
          <button type="button" className="btn small ghost" onClick={() => setShowAll(true)}>
            ほかの人
          </button>
        )}
      </div>
      <label className="form" style={{ marginTop: 14 }}>
        金額（円）
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="例：2000" />
        {yen > 0 && <small>{(yen / price).toLocaleString()}枚分</small>}
      </label>
      <div className="chips" style={{ marginTop: 8 }}>
        {presets.map((p) => (
          <button key={p} type="button" className="chip" onClick={() => setAmount(String(p))}>
            {p.toLocaleString()}円
          </button>
        ))}
      </div>
    </Sheet>
  );
}
