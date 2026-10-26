import { useEffect, useState } from "react";

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event("locationchange"));
  window.scrollTo(0, 0);
}

export function usePath(): { path: string; query: URLSearchParams } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener("popstate", on);
    window.addEventListener("locationchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("locationchange", on);
    };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

export type Route =
  | { name: "home" }
  | { name: "group"; gid: string }
  | { name: "groupTab"; gid: string; tab: "stats" | "history" | "settings" | "yakuman" }
  | { name: "session"; gid: string; sid: string; tab: SessionTab }
  | { name: "table"; gid: string; local: boolean }
  | { name: "gacha"; gid: string }
  | { name: "profile"; gid: string };

export type SessionTab = "record" | "stats" | "settle" | "history" | "settings";

export function parseRoute(path: string): Route {
  const p = path.split("/").filter(Boolean);
  if (p[0] !== "g" || !p[1]) return { name: "home" };
  const gid = p[1];
  if (p[2] === "s" && p[3]) {
    const tab = (["record", "stats", "settle", "history", "settings"] as const).find((t) => t === p[4]) ?? "record";
    return { name: "session", gid, sid: p[3], tab };
  }
  if (p[2] === "table") return { name: "table", gid, local: p[3] === "local" };
  if (p[2] === "gacha") return { name: "gacha", gid };
  if (p[2] === "profile") return { name: "profile", gid };
  if (p[2] === "stats" || p[2] === "history" || p[2] === "settings" || p[2] === "yakuman")
    return { name: "groupTab", gid, tab: p[2] };
  return { name: "group", gid };
}
