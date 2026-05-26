import type { ActivityIdentity, ActivityIdentityMode, LocalIdentityOptions } from "./types.js";

const DEFAULT_STORAGE_KEY = "discord-activity-local-identity";
const NAMES = ["Nova", "Pulse", "Vega", "Blitz", "Pixel", "Rocket", "Dash", "Echo", "Zap", "Juno"];

export function makeLocalIdentity(options: LocalIdentityOptions): ActivityIdentity {
  const params = options.urlSearchParams ?? new URLSearchParams(globalThis.window?.location.search ?? "");
  const storage = options.storage ?? globalThis.window?.sessionStorage;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const stored = storage ? readStoredIdentity(storage, storageKey) : undefined;
  const randomName = options.randomName ?? defaultRandomName;
  const randomId = options.randomId ?? defaultRandomId;
  const paramName = params.get("name")?.trim().slice(0, 32);
  const paramSessionId = params.get("session")?.trim().slice(0, 80);

  const id = options.playerId ?? stored?.id ?? randomId();
  const displayName =
    options.displayName ??
    (paramName || undefined) ??
    stored?.displayName ??
    randomName();
  const sessionId = options.sessionId ?? (paramSessionId || undefined) ?? "local-arena";
  const mode: ActivityIdentityMode = options.mode ?? "local";
  const identity = { id, displayName, sessionId, mode, note: options.note };

  storage?.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

function readStoredIdentity(storage: Storage, storageKey: string): ActivityIdentity | undefined {
  const raw = storage.getItem(storageKey);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as ActivityIdentity;
  } catch {
    storage.removeItem(storageKey);
    return undefined;
  }
}

function defaultRandomName(): string {
  return `${NAMES[Math.floor(Math.random() * NAMES.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function defaultRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2)}`;
}
