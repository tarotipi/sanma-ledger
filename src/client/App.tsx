import { parseRoute, navigate, usePath } from "./router";
import { GroupProvider, ToastHost, useGroup } from "./store";
import { GroupHome, Home, Join, PickMember } from "./screens/Entry";
import { SessionScreen } from "./screens/Session";
import { StatsView } from "./screens/Stats";
import { HistoryView } from "./screens/History";
import { SettingsView } from "./screens/Settings";
import { YakumanView } from "./screens/Yakuman";
import { Empty } from "./ui";
import { bgUrl } from "./logic";

export function App() {
  const { path } = usePath();
  const route = parseRoute(path);
  return (
    <ToastHost>
      {route.name === "home" ? (
        <Home />
      ) : (
        <GroupProvider gid={route.gid} key={route.gid}>
          <GroupGate route={route} />
        </GroupProvider>
      )}
    </ToastHost>
  );
}

function GroupGate({ route }: { route: Exclude<ReturnType<typeof parseRoute>, { name: "home" }> }) {
  const { saved, state, loadError, refresh, gid } = useGroup();
  if (!saved) return <Join />;
  if (!state)
    return (
      <main className="page narrow">
        {loadError ? (
          <>
            <Empty>{loadError}</Empty>
            <button type="button" className="btn wide" onClick={() => void refresh()}>
              もう一度読み込む
            </button>
          </>
        ) : (
          <div className="loading" aria-label="読み込み中" />
        )}
      </main>
    );
  const backdrop = state.group.bg ? (
    <div className="backdrop" style={{ backgroundImage: `url(${bgUrl(gid, saved.token, state.group.bg)})` }} aria-hidden />
  ) : null;
  return (
    <>
      {backdrop}
      <AdminBanner />
      <GroupScreen route={route} />
    </>
  );
}

function AdminBanner() {
  const { admin, setAdmin } = useGroup();
  if (!admin) return null;
  return (
    <div className="admin-banner" role="status">
      管理者モード：確認なしで編集できます
      <button type="button" onClick={() => setAdmin(false)}>
        終了
      </button>
    </div>
  );
}

function GroupScreen({ route }: { route: Exclude<ReturnType<typeof parseRoute>, { name: "home" }> }) {
  const { saved, state, gid } = useGroup();
  if (!saved || !state) return null;
  if (!saved.memberId || !state.members.some((m) => m.id === saved.memberId)) return <PickMember />;
  if (route.name === "session") return <SessionScreen sid={route.sid} tab={route.tab} />;
  if (route.name === "groupTab") {
    const title = { stats: "通算成績", history: "変更履歴", settings: "設定", yakuman: "役満の殿堂" }[route.tab];
    return (
      <>
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="戻る">
            ‹
          </button>
          <h1>{title}</h1>
          <span />
        </header>
        <main className="page">
          {route.tab === "stats" && <StatsView />}
          {route.tab === "history" && <HistoryView />}
          {route.tab === "settings" && <SettingsView />}
          {route.tab === "yakuman" && <YakumanView />}
        </main>
      </>
    );
  }
  return <GroupHome />;
}
