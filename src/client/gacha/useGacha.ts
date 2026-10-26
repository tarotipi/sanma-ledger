import { useCallback, useEffect, useState } from "react";
import { loadGroups, request } from "../api";
import type { CoinBalance, CoinType, PullResult } from "../../shared/gacha";

export type GachaData = {
  earned: CoinBalance;
  spent: CoinBalance;
  coins: CoinBalance;
  pulls: { id: string; coin: CoinType; result: PullResult; createdAt: string }[];
  partner: string;
};

export const NO_MEMBER = "先にグループ画面で自分の名前を選んでください";

/** 自分の雀霊カプセルの記録（GET /api/g/:gid/gacha） */
export function useGacha(gid: string) {
  const saved = loadGroups()[gid];
  const token = saved?.token;
  const memberId = saved?.memberId ?? null;
  const [data, setData] = useState<GachaData | null>(null);
  const [error, setError] = useState<string | null>(memberId ? null : NO_MEMBER);

  const load = useCallback(async () => {
    if (!memberId) return;
    try {
      setData(await request<GachaData>("GET", `/g/${gid}/gacha`, { token, memberId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }, [gid, token, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = useCallback(
    <T,>(method: string, path: string, body?: unknown) => request<T>(method, `/g/${gid}/gacha${path}`, { token, memberId, body }),
    [gid, token, memberId],
  );

  return { data, setData, error, reload: load, call, memberId };
}
