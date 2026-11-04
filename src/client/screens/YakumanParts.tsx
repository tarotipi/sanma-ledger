import { useRef, useState } from "react";
import { useGroup } from "../store";
import { BlobImg, Confirm, Dot, type ConfirmSpec } from "../ui";
import { addPhoto, discardItem, reviveAll, type OutboxPhoto } from "../outbox";
import type { Member, Yakuman } from "../../shared/types";

const YAKU = ["国士無双", "四暗刻", "大三元", "字一色", "緑一色", "清老頭", "小四喜", "大四喜", "四槓子", "九蓮宝燈", "天和", "地和", "数え役満"];

/** 役の名前の候補。画面に1つだけ置く */
export function YakuNames() {
  return (
    <datalist id="yaku-names">
      {YAKU.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

/** 出した人と役の名前の入力 */
export function YakuFields({
  members,
  memberId,
  name,
  placeholder = "役の名前（任意）",
  list = true,
  maxLength = 30,
  onChange,
}: {
  members: (Member | undefined)[];
  memberId: string;
  name: string;
  placeholder?: string;
  /** 役の名前の候補を出すか */
  list?: boolean;
  maxLength?: number;
  onChange: (patch: { memberId?: string; name?: string }) => void;
}) {
  return (
    <>
      <div className="chips">
        {members.map(
          (m) =>
            m && (
              <button
                key={m.id}
                type="button"
                className={`chip ${memberId === m.id ? "on" : ""}`}
                aria-pressed={memberId === m.id}
                onClick={() => onChange({ memberId: m.id })}
              >
                <Dot m={m} />
                {m.name}
              </button>
            ),
        )}
      </div>
      <input list={list ? "yaku-names" : undefined} value={name} onChange={(e) => onChange({ name: e.target.value })} placeholder={placeholder} maxLength={maxLength} />
    </>
  );
}

/** カメラとアルバムの入力。ref 経由でボタンを押した瞬間にカメラを開ける */
export function usePhotoInputs(onFile: (f: File) => void | Promise<void>) {
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void onFile(f);
  };
  return {
    openCamera: () => camera.current?.click(),
    openAlbum: () => album.current?.click(),
    inputs: (
      <>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
        <input ref={album} type="file" accept="image/*" hidden onChange={handle} />
      </>
    ),
  };
}

/** 記念写真の欄：撮った写真の確認と、カメラ／アルバムのボタン（撮影は任意） */
export function PhotoField({
  sessionId,
  yakumanId,
  beforeCamera,
  inputs,
  openCamera,
  openAlbum,
}: {
  sessionId: string;
  yakumanId: string;
  beforeCamera?: () => void;
  inputs: React.ReactNode;
  openCamera: () => void;
  openAlbum: () => void;
}) {
  const { outbox } = useGroup();
  const held = outbox.filter((x): x is OutboxPhoto => x.kind === "photo" && x.yakumanId === yakumanId && x.sessionId === sessionId);
  return (
    <div className="yaku-photo">
      {held.length > 0 && (
        <div className="photo-row">
          {held.map((p) => (
            <span key={p.id} className="thumb">
              <BlobImg blob={p.thumb} />
              <button type="button" className="thumb-x" aria-label="この写真をやめる" onClick={() => void discardItem(p.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row-between">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            beforeCamera?.();
            openCamera();
          }}
        >
          カメラで撮る
        </button>
        <button type="button" className="btn small ghost" onClick={openAlbum}>
          アルバムから選ぶ
        </button>
      </div>
      {inputs}
    </div>
  );
}

/** 写真を送信待ちへ入れる。縮小に失敗したら理由を知らせて、サーバーのログにも残す */
export function useAddPhoto() {
  const { gid, toast, api } = useGroup();
  return async (file: File, p: { sessionId: string; yakumanId: string; hold: boolean }): Promise<boolean> => {
    try {
      await addPhoto(file, { gid, ...p });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "写真を読み込めませんでした。";
      toast(message);
      void api("POST", "/client-log", { kind: "photo-prepare", message, detail: `type=${file.type} size=${file.size}` }).catch(() => undefined);
      return false;
    }
  };
}

/** 紐づける半荘の変更と、役満の記録の削除 */
export function YakumanRow({ y }: { y: Yakuman }) {
  const { state, api, refresh, toast } = useGroup();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const m = state.members.find((x) => x.id === y.memberId);
  const games = state.games
    .filter((g) => g.sessionId === y.sessionId && !g.deletedAt && !g.id.startsWith("tmp-") && g.scores.some((s) => s.memberId === y.memberId))
    .sort((a, b) => a.seq - b.seq);
  return (
    <div className="yaku-body">
      <div className="row-between">
        <span>
          役満　<b>{m?.name}</b> {y.name}
        </span>
        <button
          type="button"
          className="btn small ghost danger"
          onClick={() =>
            setConfirm({
              title: "役満の記録を削除しますか",
              body: <p>削除した記録は履歴から元に戻せます。</p>,
              okLabel: "削除する",
              danger: true,
              onOk: async () => {
                try {
                  await api("POST", `/yakuman/${y.id}/delete`);
                  toast("役満の記録を削除しました");
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
      </div>
      <label className="yaku-link">
        半荘
        <select
          value={y.gameId ?? ""}
          onChange={async (e) => {
            try {
              await api("PATCH", `/yakuman/${y.id}`, { gameId: e.target.value || null });
              toast("役満の半荘を変更しました");
            } catch (err) {
              toast(err instanceof Error ? err.message : "変更できませんでした。");
            } finally {
              await refresh();
            }
          }}
        >
          <option value="">次に記録する半荘へ紐づける</option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              第{g.seq}半荘
            </option>
          ))}
        </select>
      </label>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** 未送信の役満と写真の表示。送れたものは自動で消える */
export function OutboxBar() {
  const { outbox, gid, flush, toast } = useGroup();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const waiting = outbox.filter((x) => !(x.kind === "photo" && x.hold));
  if (!waiting.length) return null;
  const photos = waiting.filter((x) => x.kind === "photo").length;
  const yakuman = waiting.length - photos;
  const dead = waiting.filter((x) => x.dead);
  const error = waiting.find((x) => x.error)?.error;
  return (
    <div className={`outbox-bar ${error ? "bad" : ""}`} role="status">
      <p>
        未送信：{[yakuman ? `役満${yakuman}件` : "", photos ? `写真${photos}枚` : ""].filter(Boolean).join("・")}
        {error ? `（${error}）` : "を送信中です。"}
        <small>この端末に保存してあるので、閉じても消えません。</small>
      </p>
      <div className="row-between">
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            await reviveAll(gid);
            await flush();
            toast("送り直しました");
          }}
        >
          今すぐ再送
        </button>
        {dead.length > 0 && (
          <button
            type="button"
            className="btn small ghost danger"
            onClick={() =>
              setConfirm({
                title: `送れない${dead.length}件を破棄しますか`,
                body: <p>この端末からも消えて、元に戻せません。</p>,
                okLabel: "破棄する",
                danger: true,
                onOk: async () => {
                  await Promise.all(dead.map((x) => discardItem(x.id)));
                },
              })
            }
          >
            送れない分を破棄
          </button>
        )}
      </div>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
