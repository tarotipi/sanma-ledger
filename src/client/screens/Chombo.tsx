import { useState } from "react";
import { useGroup } from "../store";
import { Confirm, Empty, fmtDate, type ConfirmSpec } from "../ui";
import type { Chombo } from "../../shared/types";

/** チョンボの1件。入力は半荘の記録の中で行う（F-37） */
function ChomboRow({ c, showDate }: { c: Chombo; showDate?: boolean }) {
  const { state, api, refresh, toast } = useGroup();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const m = state.members.find((x) => x.id === c.memberId);
  const s = state.sessions.find((x) => x.id === c.sessionId);
  return (
    <div className="chombo-row row-between">
      <span>
        チョンボ　<b>{m?.name}</b> {c.memo}
        {showDate && s ? `　${fmtDate(s.playedOn)}` : ""}
      </span>
      <button
        type="button"
        className="btn small ghost danger"
        onClick={() =>
          setConfirm({
            title: "チョンボの記録を削除しますか",
            body: <p>削除した記録は履歴から元に戻せます。</p>,
            okLabel: "削除する",
            danger: true,
            onOk: async () => {
              try {
                await api("POST", `/chombo/${c.id}/delete`);
                toast("チョンボの記録を削除しました");
                await refresh();
              } catch (e) {
                toast(e instanceof Error ? e.message : "削除できませんでした。");
              }
            },
          })
        }
      >
        削除
      </button>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** 全対局のチョンボ（履歴から見る） */
export function ChomboHall() {
  const { state } = useGroup();
  if (!state) return null;
  const live = new Set(state.sessions.filter((s) => !s.deletedAt).map((s) => s.id));
  const list = state.chombo.filter((c) => !c.deletedAt && live.has(c.sessionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return <Empty>チョンボの記録はありません。</Empty>;
  const count = new Map<string, number>();
  list.forEach((c) => count.set(c.memberId, (count.get(c.memberId) ?? 0) + 1));
  const mm = new Map(state.members.map((m) => [m.id, m]));
  return (
    <section className="chombo-hall">
      <p className="note">
        チョンボの回数：{[...count.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${mm.get(id)?.name} ${n}回`).join("　")}
      </p>
      <div className="chombo-list">
        {list.map((c) => (
          <ChomboRow key={c.id} c={c} showDate />
        ))}
      </div>
    </section>
  );
}
