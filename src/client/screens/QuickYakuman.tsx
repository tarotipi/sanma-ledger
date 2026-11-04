import { useEffect, useState } from "react";
import { newId } from "../api";
import { addYakuman, discardHeld, releaseHeld } from "../outbox";
import { useGroup } from "../store";
import { Sheet } from "../ui";
import { PhotoField, YakuFields, YakuNames, useAddPhoto, usePhotoInputs } from "./YakumanParts";

type Draft = { yakumanId: string; memberId: string; name: string };

const draftKey = (gid: string, sid: string) => `sanma.quick.${gid}.${sid}`;

function loadDraft(gid: string, sid: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(gid, sid)) ?? "null") as Draft | null;
  } catch {
    return null;
  }
}

function saveDraft(gid: string, sid: string, d: Draft | null): void {
  try {
    if (d) localStorage.setItem(draftKey(gid, sid), JSON.stringify(d));
    else localStorage.removeItem(draftKey(gid, sid));
  } catch {
    /* 保存できない環境でも動作は続ける */
  }
}

/**
 * 「役満！」：対局の途中で、手牌を崩す前に撮って記録する。
 * 記録した役満は、その人が卓にいる次の半荘へサーバーが自動で紐づける。
 */
export function QuickYakuman({ sid }: { sid: string }) {
  const { state, gid, flush, toast } = useGroup();
  const addPhoto = useAddPhoto();
  // カメラから戻ったときにアプリが再読み込みされても、入力の途中から続ける
  const [draft, setDraft] = useState<Draft | null>(() => loadDraft(gid, sid));
  useEffect(() => saveDraft(gid, sid, draft), [gid, sid, draft]);

  const { inputs, openCamera, openAlbum } = usePhotoInputs(async (f) => {
    if (draft) await addPhoto(f, { sessionId: sid, yakumanId: draft.yakumanId, hold: true });
  });

  if (!state) return null;
  const members = state.members.filter((m) => !m.hidden);

  const cancel = () => {
    if (draft) void discardHeld(gid, [draft.yakumanId]);
    setDraft(null);
  };

  const save = async () => {
    if (!draft?.memberId) return;
    const { yakumanId, memberId, name } = draft;
    setDraft(null);
    await addYakuman({ id: yakumanId, gid, sessionId: sid, gameId: null, memberId, name: name.trim() });
    await releaseHeld(gid, [yakumanId]);
    toast("役満を記録しました");
    await flush();
  };

  return (
    <>
      <button
        type="button"
        className="btn wide yaku-now"
        onClick={() => {
          setDraft({ yakumanId: newId(), memberId: "", name: "" });
          openCamera(); // 押した瞬間にカメラを開く。撮らずに戻っても記録はできる
        }}
      >
        役満！（手牌を撮る）
      </button>
      <Sheet
        open={!!draft}
        onClose={cancel}
        title="役満を記録"
        footer={
          <button type="button" className="btn primary wide" disabled={!draft?.memberId} onClick={() => void save()}>
            記録する
          </button>
        }
      >
        {draft && (
          <section className="editor yaku">
            <h3>出した人</h3>
            <div className="yaku-body">
              <YakuFields members={members} memberId={draft.memberId} name={draft.name} onChange={(p) => setDraft({ ...draft, ...p })} />
              <YakuNames />
            </div>
            <h3>手牌の写真（任意）</h3>
            <PhotoField sessionId={sid} yakumanId={draft.yakumanId} inputs={null} openCamera={openCamera} openAlbum={openAlbum} />
            <p className="note">次に記録する半荘へ、自動で紐づきます。</p>
          </section>
        )}
      </Sheet>
      {inputs}
    </>
  );
}
