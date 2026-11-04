// 役満と写真の純粋関数（画面とサーバーで共用）。

/** 半荘に紐づいていない役満のうち、出した人がこの半荘の卓にいるものを、紐づける対象として返す */
export function yakumanToLink(waiting: readonly { id: string; memberId: string }[], scores: readonly { memberId: string }[]): string[] {
  const players = new Set(scores.map((s) => s.memberId));
  return waiting.filter((y) => players.has(y.memberId)).map((y) => y.id);
}

/** 長辺を maxSide 以下にした大きさ。拡大はしない */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 送信に失敗したとき、自動で送り直してよいか。
 * 通信エラー（0）・時間切れ・サーバー側の失敗は送り直す。
 * 404 は先に送る役満がまだ届いていない場合があるので送り直す。それ以外の4xxは内容の問題なので止める。
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 404 || status === 408 || status === 429 || status >= 500;
}
