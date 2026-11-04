export type SavedGroup = { id: string; name: string; token: string; memberId: string | null };

const KEY = "sanma.groups.v1";

export function loadGroups(): Record<string, SavedGroup> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, SavedGroup>;
  } catch {
    return {};
  }
}

export function saveGroup(g: SavedGroup): void {
  try {
    const all = loadGroups();
    all[g.id] = g;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 保存できない環境でも動作は続ける */
  }
}

export function forgetGroup(id: string): void {
  try {
    const all = loadGroups();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 端末で作るID。再送しても二重にならないように使う */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

export async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; memberId?: string | null; body?: unknown; raw?: Blob; form?: FormData; query?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.memberId) headers["x-member"] = opts.memberId;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // content-type はブラウザが境界付きで付ける
  } else if (opts.raw) {
    headers["content-type"] = opts.raw.type;
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  // 電波が悪いと fetch が返ってこないことがあるので、必ず時間で打ち切る
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), opts.form || opts.raw ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, { method, headers, body, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, ctrl.signal.aborted ? "時間内に送れませんでした。電波の届く場所でもう一度試してください。" : "通信できませんでした。電波の届く場所でもう一度試してください。");
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `エラーが起きました（${res.status}）`);
  return data as T;
}
