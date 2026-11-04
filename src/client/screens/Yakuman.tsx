import { useRef, useState } from "react";
import { useGroup } from "../store";
import { BlobImg, Confirm, Empty, RetryImg, Sheet, fmtDate, type ConfirmSpec } from "../ui";
import type { OutboxPhoto } from "../outbox";
import type { Photo, Yakuman } from "../../shared/types";
import { OutboxBar, useAddPhoto } from "./YakumanParts";
import { ChomboHall } from "./Chombo";

/** 役満の殿堂：これまでの役満と記念写真 */
export function YakumanView() {
  const { state, outbox } = useGroup();
  if (!state) return null;
  const liveSessions = new Set(state.sessions.filter((s) => !s.deletedAt).map((s) => s.id));
  const liveGames = new Set(state.games.filter((g) => !g.deletedAt).map((g) => g.id));
  const known = new Set(state.yakuman.map((y) => y.id));
  // 未送信の役満も、届く前から一覧に出す
  const unsent: Yakuman[] = outbox.flatMap((x) =>
    x.kind === "yakuman" && !known.has(x.id)
      ? [{ id: x.id, sessionId: x.sessionId, gameId: x.gameId, memberId: x.memberId, name: x.name, createdAt: x.createdAt, deletedAt: null }]
      : [],
  );
  const list = [...state.yakuman, ...unsent]
    .filter((y) => !y.deletedAt && liveSessions.has(y.sessionId) && (!y.gameId || liveGames.has(y.gameId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length)
    return (
      <>
        <Empty>まだ役満はありません。対局中の「役満！」か、半荘の記録の「役満が出た」から記録すると、ここに残ります。</Empty>
        <ChomboHall />
      </>
    );
  const count = new Map<string, number>();
  list.forEach((y) => count.set(y.memberId, (count.get(y.memberId) ?? 0) + 1));
  const ranking = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  return (
    <>
      <OutboxBar />
      <p className="note">
        役満の回数：{ranking.map(([id, n]) => `${mm.get(id)?.name} ${n}回`).join("　")}
      </p>
      <ol className="hall">
        {list.map((y) => (
          <HallCard key={y.id} y={y} />
        ))}
      </ol>
      <ChomboHall />
    </>
  );
}

function HallCard({ y }: { y: Yakuman }) {
  const { state, outbox, api, refresh, flush, toast } = useGroup();
  const addPhoto = useAddPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<Photo | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const m = state.members.find((x) => x.id === y.memberId);
  const s = state.sessions.find((x) => x.id === y.sessionId);
  const g = state.games.find((x) => x.id === y.gameId);
  const photos = state.photos.filter((p) => p.yakumanId === y.id && !p.deletedAt);
  const known = new Set(state.photos.map((p) => p.id));
  const unsent = outbox.filter((x): x is OutboxPhoto => x.kind === "photo" && x.yakumanId === y.id && !x.hold && !known.has(x.id));
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
            <RetryImg src={p.thumbUrl} loading="lazy" decoding="async" onFail={() => void refresh()} />
          </button>
        ))}
        {unsent.map((p) => (
          <span key={p.id} className={`thumb sending ${p.error ? "bad" : ""}`}>
            <BlobImg blob={p.thumb} />
            <small>{p.error ? "未送信" : "送信中"}</small>
          </span>
        ))}
        <button type="button" className="thumb add" onClick={() => input.current?.click()}>
          ＋記念写真
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
          if (await addPhoto(f, { sessionId: y.sessionId, yakumanId: y.id, hold: false })) await flush();
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
        {view && <RetryImg src={view.url} style={{ width: "100%", borderRadius: 8 }} onFail={() => void refresh()} />}
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </li>
  );
}
