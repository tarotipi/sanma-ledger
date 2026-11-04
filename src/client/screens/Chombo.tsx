import { useRef, useState } from "react";
import { newId } from "../api";
import { useGroup } from "../store";
import { Confirm, Sheet, fmtDate, type ConfirmSpec } from "../ui";
import type { Chombo } from "../../shared/types";
import { YakuFields } from "./YakumanParts";

/** 「チョンボ」：点数と精算には影響しない記録。やった本人にチョンボコインが入る（F-37） */
export function QuickChombo({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  // 送り直しても二重にならないように、開くたびにIDを1つ決めておく
  const clientId = useRef(newId());
  if (!state) return null;
  const members = state.members.filter((m) => !m.hidden);

  const save = async () => {
    setSaving(true);
    try {
      await api("POST", "/chombo", { clientId: clientId.current, sessionId: sid, memberId, memo: memo.trim() });
      setOpen(false);
      toast("チョンボを記録しました（コイン+1）");
      await refresh();
    } catch (e) {
      // 入力は消さずに画面を開いたままにする
      toast(e instanceof Error ? e.message : "記録できませんでした。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn wide chombo-now"
        onClick={() => {
          clientId.current = newId();
          setMemberId("");
          setMemo("");
          setOpen(true);
        }}
      >
        チョンボを記録
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="チョンボを記録"
        footer={
          <button type="button" className="btn primary wide" disabled={!memberId || saving} onClick={() => void save()}>
            {saving ? "保存中…" : "記録する"}
          </button>
        }
      >
        {open && (
          <section className="editor">
            <h3>やった人</h3>
            <div className="yaku-body">
              <YakuFields members={members} memberId={memberId} name={memo} placeholder="メモ（任意）" list={false} maxLength={60} onChange={(p) => {
                if (p.memberId !== undefined) setMemberId(p.memberId);
                if (p.name !== undefined) setMemo(p.name);
              }} />
            </div>
            <p className="note">点数と精算には影響しません。やった人にチョンボコインが1枚入ります。</p>
          </section>
        )}
      </Sheet>
    </>
  );
}

function Row({ c, showDate }: { c: Chombo; showDate?: boolean }) {
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

/** この対局のチョンボ */
export function ChomboList({ sid }: { sid: string }) {
  const { state } = useGroup();
  const list = state?.chombo.filter((c) => c.sessionId === sid && !c.deletedAt) ?? [];
  if (!list.length) return null;
  return (
    <section className="chombo-list" aria-label="この対局のチョンボ">
      {list.map((c) => (
        <Row key={c.id} c={c} />
      ))}
    </section>
  );
}

/** 全対局のチョンボ（役満の殿堂の下に出す） */
export function ChomboHall() {
  const { state } = useGroup();
  if (!state) return null;
  const live = new Set(state.sessions.filter((s) => !s.deletedAt).map((s) => s.id));
  const list = state.chombo.filter((c) => !c.deletedAt && live.has(c.sessionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return null;
  const count = new Map<string, number>();
  list.forEach((c) => count.set(c.memberId, (count.get(c.memberId) ?? 0) + 1));
  const mm = new Map(state.members.map((m) => [m.id, m]));
  return (
    <section className="chombo-hall">
      <h2>チョンボの記録</h2>
      <p className="note">
        チョンボの回数：{[...count.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${mm.get(id)?.name} ${n}回`).join("　")}
      </p>
      <div className="chombo-list">
        {list.map((c) => (
          <Row key={c.id} c={c} showDate />
        ))}
      </div>
    </section>
  );
}
