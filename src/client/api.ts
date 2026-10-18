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

export async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; memberId?: string | null; body?: unknown; raw?: Blob; query?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.memberId) headers["x-member"] = opts.memberId;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["content-type"] = opts.raw.type;
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, { method, headers, body });
  } catch {
    throw new ApiError(0, "通信できませんでした。電波の届く場所でもう一度試してください。");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `エラーが起きました（${res.status}）`);
  return data as T;
}
