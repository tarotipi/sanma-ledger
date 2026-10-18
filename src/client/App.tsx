import { parseRoute, navigate, usePath } from "./router";
import { GroupProvider, ToastHost, useGroup } from "./store";
import { GroupHome, Home, Join, PickMember } from "./screens/Entry";
import { SessionScreen } from "./screens/Session";
import { StatsView } from "./screens/Stats";
import { HistoryView } from "./screens/History";
import { SettingsView } from "./screens/Settings";
import { Empty } from "./ui";

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
  if (!saved.memberId || !state.members.some((m) => m.id === saved.memberId)) return <PickMember />;
  if (route.name === "session") return <SessionScreen sid={route.sid} tab={route.tab} />;
  if (route.name === "groupTab") {
    const title = { stats: "通算成績", history: "変更履歴", settings: "設定" }[route.tab];
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
        </main>
      </>
    );
  }
  return <GroupHome />;
}
