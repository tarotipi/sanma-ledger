import { useRef, useState } from "react";
import { useGroup } from "../store";
import { Confirm, Empty, Sheet, fmtDate, type ConfirmSpec } from "../ui";
import { resizeImage } from "../logic";
import type { Photo, Yakuman } from "../../shared/types";

/** 役満の殿堂：これまでの役満と記念写真 */
export function YakumanView() {
  const { state } = useGroup();
  if (!state) return null;
  const list = state.yakuman.filter((y) => !y.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return <Empty>まだ役満はありません。半荘を記録するときに「役満が出た」を押すと、ここに残ります。</Empty>;
  const count = new Map<string, number>();
  list.forEach((y) => count.set(y.memberId, (count.get(y.memberId) ?? 0) + 1));
  const ranking = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  return (
    <>
      <p className="note">
        役満の回数：{ranking.map(([id, n]) => `${mm.get(id)?.name} ${n}回`).join("　")}
      </p>
      <ol className="hall">
        {list.map((y) => (
          <HallCard key={y.id} y={y} />
        ))}
      </ol>
    </>
  );
}

function HallCard({ y }: { y: Yakuman }) {
  const { state, gid, saved, api, refresh, toast } = useGroup();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Photo | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state || !saved) return null;
  const m = state.members.find((x) => x.id === y.memberId);
  const s = state.sessions.find((x) => x.id === y.sessionId);
  const g = state.games.find((x) => x.id === y.gameId);
  const photos = state.photos.filter((p) => p.gameId === y.id && !p.deletedAt);
  const src = (p: Photo) => `/api/g/${gid}/photos/${p.id}/file?t=${encodeURIComponent(saved.token)}`;
  return (
    <li className="hall-card">
      <h3>{y.name || "役満"}</h3>
      <p className="meta">
        <span className="dot" style={{ background: m?.color, display: "inline-block", marginRight: 6 }} />
        {m?.name}　{s ? fmtDate(s.playedOn) : ""}
        {g ? `　第${g.seq}半荘` : ""}
      </p>
      <div className="photo-row">
        {photos.map((p) => (
          <button key={p.id} type="button" className="thumb" onClick={() => setView(p)} aria-label="記念写真を拡大">
            <img src={src(p)} alt="" loading="lazy" />
          </button>
        ))}
        <button type="button" className="thumb add" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "送信中" : "＋記念写真"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const { blob, width, height } = await resizeImage(f);
            await api("POST", "/photos", undefined, {
              raw: blob,
              query: { sessionId: y.sessionId, yakumanId: y.id, w: String(width), h: String(height) },
            });
            toast("記念写真を追加しました");
            await refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : "追加できませんでした。");
          } finally {
            setBusy(false);
          }
        }}
      />
      <Sheet
        open={!!view}
        onClose={() => setView(null)}
        title="記念写真"
        footer={
          view && (
            <button
              type="button"
              className="btn danger ghost"
              onClick={() => {
                const p = view;
                setConfirm({
                  title: "写真を削除しますか",
                  body: <p>削除した写真は履歴から元に戻せます。</p>,
                  okLabel: "削除する",
                  danger: true,
                  onOk: async () => {
                    try {
                      await api("POST", `/photos/${p.id}/delete`);
                      setView(null);
                      toast("写真を削除しました");
                      await refresh();
                    } catch (err) {
                      toast(err instanceof Error ? err.message : "削除できませんでした。");
                    }
                  },
                });
              }}
            >
              削除する
            </button>
          )
        }
      >
        {view && <img src={src(view)} alt="" style={{ width: "100%", borderRadius: 8 }} />}
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </li>
  );
}
