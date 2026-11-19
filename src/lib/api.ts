import type { SavedState, Source } from "../types";

// Content responses are cached per URL. Scope polling uses a separate small
// fingerprint endpoint; only a detected change requests a new refresh value,
// superseding the older cached responses of its route.
const requests = new Map<string, { route: string; refresh?: string; promise: Promise<unknown> }>();
export function api<T>(
  route: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = `/api/${route}?${new URLSearchParams(params)}`;
  let request = requests.get(url);
  if (!request) {
    if (params.refresh !== undefined)
      for (const [key, cached] of requests)
        if (cached.route === route && cached.refresh !== params.refresh) requests.delete(key);
    const promise = fetch(url, { headers: { "X-Rv": "1" } }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    });
    promise.catch(() => requests.delete(url));
    request = { route, refresh: params.refresh, promise };
    requests.set(url, request);
  }
  return request.promise as Promise<T>;
}

export async function patchState(state: SavedState, keepalive = false) {
  const response = await fetch("/api/state", {
    method: "PATCH",
    headers: { "X-Rv": "1" },
    body: JSON.stringify(state),
    keepalive,
  });
  if (!response.ok) throw new Error((await response.json()).error);
}

export async function loadFile(path: string, ref: string, refresh: number, fingerprint = false): Promise<Source> {
  const file = await api<Source>("file", {
    path, ref, refresh: String(refresh), ...(fingerprint ? { hash: "true" } : {}),
  });
  return file && { ...file, cacheKey: JSON.stringify([refresh, ref, path]) };
}
