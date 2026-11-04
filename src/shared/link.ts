/** 貼り付けられた招待リンクからグループIDを取り出す。読めなければ null */
export function groupIdFromLink(text: string): string | null {
  return text.trim().match(/\/g\/([0-9a-zA-Z-]{8,})/)?.[1] ?? null;
}
