import { useMemo } from "react";
import { useGroup } from "../store";
import { navigate } from "../router";
import { SpiritArt } from "../gacha/SpiritArt";
import { useGacha } from "../gacha/useGacha";
import "../gacha/gacha.css";
import { GACHA, SPIRITS, SYSTEMS, buildCollection, spiritById } from "../../shared/gacha";

/** プロフィール：自分の名前・相棒の雀霊・コレクションの簡単な記録 */
export function ProfileScreen() {
  const { gid, member } = useGroup();
  const { data, error } = useGacha(gid);
  const col = useMemo(() => buildCollection(data?.pulls.map((p) => p.result) ?? []), [data]);
  const sp = data ? spiritById(data.partner) : undefined;
  const stage = sp ? Math.max(0, col.stages[sp.id] ?? 0) : 0;
  const evolved = Object.values(col.stages).filter((s) => s > 0).length;
  const maxed = Object.values(col.stages).filter((s) => s >= GACHA.MAX_STAGE).length;
  const legends = col.spirits.filter((id) => spiritById(id)?.rarity === "legend").length;
  const items = Object.values(col.items).reduce((a, b) => a + b, 0);
  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="戻る">
          ‹
        </button>
        <h1>プロフィール</h1>
        <span />
      </header>
      <main className="page gacha">
        <h2 className="profile-name">{member?.name}</h2>
        {error ? (
          <p className="note">{error}</p>
        ) : !data || !sp ? (
          <div className="loading" aria-label="読み込み中" />
        ) : (
          <>
            <section className={`profile-partner stage-${stage} ${sp.rarity === "legend" ? "legend" : ""}`} style={{ borderColor: sp.color }}>
              <small>相棒</small>
              <SpiritArt spiritId={sp.id} stage={stage} size={180} />
              <strong>{sp.stages[stage]}</strong>
              <span>
                {SYSTEMS[sp.system].name}・{stage === 0 ? "基本" : `第${stage}進化`}
                {sp.rarity === "legend" ? "・伝説" : ""}
              </span>
            </section>
            <dl className="profile-stats">
              <div>
                <dt>雀霊</dt>
                <dd>
                  {col.spirits.length} / {SPIRITS.length}
                </dd>
              </div>
              <div>
                <dt>伝説</dt>
                <dd>{legends} / 3</dd>
              </div>
              <div>
                <dt>進化した雀霊</dt>
                <dd>{evolved}</dd>
              </div>
              <div>
                <dt>最終進化</dt>
                <dd>{maxed}</dd>
              </div>
              <div>
                <dt>装備</dt>
                <dd>{items}個</dd>
              </div>
              <div>
                <dt>回した回数</dt>
                <dd>{data.pulls.length}回</dd>
              </div>
              <div>
                <dt>雀霊コイン</dt>
                <dd>{data.coins.normal}枚</dd>
              </div>
              <div>
                <dt>役満コイン</dt>
                <dd>{data.coins.yakuman}枚</dd>
              </div>
            </dl>
            <button type="button" className="btn primary wide" onClick={() => navigate(`/g/${gid}/gacha`)}>
              雀霊カプセルへ
            </button>
          </>
        )}
      </main>
    </>
  );
}
