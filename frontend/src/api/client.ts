import Constants from "expo-constants";
import { Platform } from "react-native";
import { getItem, migrateLegacy, setItem } from "./storage";

export class ApiError extends Error {
  code: string; status: number; details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

const LEGACY_KEY = "localmind.tokens";
const K = { access: "localmind.access", refresh: "localmind.refresh", session: "localmind.session" };
export interface Tokens { access: string; refresh: string; session_id?: string | null }

function resolveBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  const extra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  // When the built web client is served by the LocalMind backend itself (the
  // standalone/offline launcher), the API is same-origin: no configuration
  // needed on any machine. The Expo dev server (port 8081/8082) still falls
  // back to the configured URL.
  const sameOrigin = Platform.OS === "web" && typeof window !== "undefined" && !/:(8081|8082|19006)$/.test(window.location.host) ? window.location.origin : "";
  let url = env || sameOrigin || extra || "http://127.0.0.1:8000";
  if (Platform.OS === "android" && url.includes("127.0.0.1")) url = url.replace("127.0.0.1", "10.0.2.2");
  return url.replace(/\/$/, "");
}
export const BASE_URL = resolveBaseUrl();

let tokens: Tokens | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export const tokenStore = {
  get: () => tokens,
  async load() {
    const legacy = await migrateLegacy(LEGACY_KEY);
    if (legacy) { try { await tokenStore.set(JSON.parse(legacy)); return tokens; } catch { /* fall through */ } }
    const [access, refresh, session_id] = await Promise.all([getItem(K.access), getItem(K.refresh), getItem(K.session)]);
    tokens = access && refresh ? { access, refresh, session_id } : null;
    return tokens;
  },
  async set(t: Tokens | null) {
    tokens = t;
    await Promise.all([setItem(K.access, t?.access ?? null), setItem(K.refresh, t?.refresh ?? null), setItem(K.session, t?.session_id ?? null)]);
  },
  setSessionLostHandler(fn: (() => void) | null) { onSessionLost = fn; },
};

async function refreshTokens(): Promise<boolean> {
  if (!tokens?.refresh) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: tokens!.refresh }) });
        if (!res.ok) return false;
        const data = await res.json();
        await tokenStore.set({ ...tokens!, access: data.access, refresh: data.refresh ?? tokens!.refresh });
        return true;
      } catch { return false; } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

interface Options { method?: string; body?: unknown; form?: FormData; query?: Record<string, string | number | undefined | null>; auth?: boolean; retry?: boolean }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, form, query, auth = true, retry = true } = opts;
  let url = `${BASE_URL}/api${path}`;
  if (query) {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth && tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  let res: Response;
  try { res = await fetch(url, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) }); }
  catch { throw new ApiError(0, "NETWORK", "Cannot reach the server. Check your connection and the API address."); }
  if (res.status === 401 && auth && retry && tokens) {
    if (await refreshTokens()) return api<T>(path, { ...opts, retry: false });
    await tokenStore.set(null); onSessionLost?.();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "VALIDATION_ERROR" && e.details) {
      const parts = Object.entries(e.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      if (parts.length) return parts.join("\n");
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
