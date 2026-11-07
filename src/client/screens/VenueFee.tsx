import { useState } from "react";
import { useGroup } from "../store";
import { Confirm, Name, type ConfirmSpec } from "../ui";
import { RULES, fmtYen, splitFeeByResult } from "../../shared/mahjong";
import type { Adjustment, GroupState } from "../../shared/types";
import { lifetimeBefore, previousSessionOf, sessionBalances, settledImpact } from "../logic";
import { SettledWarning } from "./GameEditor";

/** 場代：金額を入れると、当日の収支・通算・半荘数・前回の精算に応じて分ける（F-40） */
export function VenueFeeCard({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyMember, setBusyMember] = useState("");
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const balances = sessionBalances(state, sid);
  const life = lifetimeBefore(state, sid);
  const members = state.members.filter((m) => (balances[m.id]?.games ?? 0) > 0 || (balances[m.id]?.chips ?? 0) !== 0);
  if (!members.length) return null;

  const existing = state.adjustments.find((a) => a.sessionId === sid && !a.deletedAt && a.memo.startsWith("場代"));
  const prevOf = (memberId: string) => previousSessionOf(state, sid, memberId);
  const settlementOf = (memberId: string) => {
    const prev = prevOf(memberId);
    return prev ? state.settlements.find((x) => x.sessionId === prev.id && x.memberId === memberId && !x.deletedAt) : undefined;
  };

  const yen = Number(amount);
  const valid = Number.isInteger(yen) && yen > 0;
  const shares = splitFeeByResult(
    valid ? yen : 0,
    members.map((m) => ({
      memberId: m.id,
      day: (balances[m.id]?.mahjong ?? 0) + (balances[m.id]?.chips ?? 0),
      lifetime: life[m.id] ?? 0,
      games: balances[m.id]?.games ?? 0,
      settled: !!settlementOf(m.id),
    })),
  );
  const yenOf = new Map(shares.map((s) => [s.memberId, s.yen]));
  const sorted = [...members].sort((a, b) => (balances[b.id]?.total ?? 0) - (balances[a.id]?.total ?? 0));

  // 前回の対局を開かなくても、ここで前回の精算済みを切り替えられる
  const toggleSettled = async (memberId: string) => {
    const prev = prevOf(memberId);
    if (!prev) return;
    setBusyMember(memberId);
    try {
      const cur = settlementOf(memberId);
      if (cur) await api("POST", `/settlements/${cur.id}/delete`);
      else await api("POST", "/settlements", { sessionId: prev.id, memberId, yen: sessionBalances(state, prev.id)[memberId]?.total ?? 0 });
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      setBusyMember("");
    }
  };

  const save = async () => {
    const lines = shares.filter((s) => s.yen > 0).map((s) => ({ memberId: s.memberId, yen: -s.yen }));
    const memo = `場代 ${yen.toLocaleString()}円（収支に応じて）`;
    const draft: Adjustment = { id: "draft", sessionId: sid, kind: "external", lines, memo, createdAt: "", deletedAt: null };
    const next: GroupState = { ...state, adjustments: [...state.adjustments, draft] };
    const impact = settledImpact(state, next, sid);
    const run = async () => {
      setSaving(true);
      try {
        await api("POST", "/adjustments", { sessionId: sid, kind: "external", lines, memo });
        setAmount("");
        toast("場代を記録しました");
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : "保存できませんでした。");
      } finally {
        setSaving(false);
      }
    };
    if (impact.length) setConfirm({ title: "精算済みの人がいます", body: <SettledWarning impact={impact} state={state} />, okLabel: "記録する", onOk: run });
    else await run();
  };

  return (
    <section className="block venue-fee">
      <h2>場代</h2>
      {existing ? (
        <p className="note">この対局の場代は記録済みです（{existing.memo}）。直すときは、下の「調整」で編集か削除をしてください。</p>
      ) : (
        <label>
          場代の金額（円）
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="6000" />
        </label>
      )}
      <ul className="fee-rows">
        {sorted.map((m) => {
          const prev = prevOf(m.id);
          const done = !!settlementOf(m.id);
          return (
            <li key={m.id}>
              <div className="row-between">
                <Name m={m} />
                {!existing && valid && <b className="num">{(yenOf.get(m.id) ?? 0).toLocaleString()}円</b>}
              </div>
              <p className="note">
                当日 {fmtYen((balances[m.id]?.mahjong ?? 0) + (balances[m.id]?.chips ?? 0))}　通算 {fmtYen(life[m.id] ?? 0)}　{balances[m.id]?.games ?? 0}半荘
              </p>
              {prev && (
                <button type="button" className={`btn small ${done ? "fee-done" : "ghost"}`} disabled={busyMember === m.id} aria-pressed={done} onClick={() => void toggleSettled(m.id)}>
                  {done ? "✓ 前回の精算済み" : "前回の精算を済ませた"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="note">
        勝っている人、通算で勝っている人、長く打った人が多めに払います。当日{RULES.FEE_LOSS_LIMIT.toLocaleString()}円を超える負けは基本的に払わず、当日{RULES.FEE_BIG_WIN.toLocaleString()}円以上勝った人がいれば、その人が全額払います。前回の精算を済ませた人は2割軽くなります。
      </p>
      {!existing && (
        <button type="button" className="btn primary wide" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? "記録中…" : "この金額で場代を記録"}
        </button>
      )}
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
