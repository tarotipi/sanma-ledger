import { useRef, useState } from "react";
import { useGroup } from "../store";
import { Confirm, Sheet, fmtDateTime, type ConfirmSpec } from "../ui";
import { photoUrl, resizeImage } from "../logic";
import type { Photo } from "../../shared/types";

export async function uploadPhoto(
  api: ReturnType<typeof useGroup>["api"],
  file: File,
  sessionId: string,
  gameId: string | null,
): Promise<void> {
  const { blob, width, height } = await resizeImage(file);
  const query: Record<string, string> = { sessionId, w: String(width), h: String(height) };
  if (gameId) query.gameId = gameId;
  await api("POST", "/photos", undefined, { raw: blob, query });
}

export function PhotoStrip({ sessionId, gameId }: { sessionId: string; gameId: string | null }) {
  const { state, saved, gid, api, refresh, toast } = useGroup();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Photo | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state || !saved) return null;
  const photos = state.photos.filter(
    (p) => !p.deletedAt && p.sessionId === sessionId && (gameId ? p.gameId === gameId : true),
  );

  return (
    <div className="photos">
      <div className="photo-row">
        {photos.map((p) => (
          <button key={p.id} type="button" className="thumb" onClick={() => setView(p)} aria-label="写真を拡大">
            <img src={photoUrl(gid, saved.token, p.id)} alt="" loading="lazy" />
          </button>
        ))}
        <button type="button" className="thumb add" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "送信中" : "＋写真"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            for (const f of files) await uploadPhoto(api, f, sessionId, gameId);
            toast(`写真を${files.length}枚追加しました`);
            await refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : "写真を追加できませんでした。");
          } finally {
            setBusy(false);
          }
        }}
      />
      <Sheet
        open={!!view}
        onClose={() => setView(null)}
        title={view ? `写真（${fmtDateTime(view.createdAt)}）` : ""}
        footer={
          view && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const p = view;
                setConfirm({
                  title: "写真を削除しますか",
                  body: <p>削除した写真は変更履歴から元に戻せます。</p>,
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
        {view && <img className="photo-full" src={photoUrl(gid, saved.token, view.id)} alt="" />}
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
