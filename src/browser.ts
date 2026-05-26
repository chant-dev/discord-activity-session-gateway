import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import { makeLocalIdentity } from "./localIdentity.js";
import type {
  ActivityIdentity,
  ActivityLayoutMode,
  ActivityUser,
  DiscordLayoutUpdate,
  DiscordSdkFactory,
  DiscordSdkLike,
  GatewayPlayer,
  JoinSessionPayload
} from "./types.js";

export interface ResolveActivityIdentityOptions {
  clientId?: string;
  apiBaseUrl?: string;
  tokenExchangePath?: string;
  oauthState?: string;
  authorizeScopes?: string[];
  prompt?: "none" | "consent";
  forceLocal?: boolean;
  localSessionId?: string;
  localStorageKey?: string;
  localFallbackNote?: string;
  urlSearchParams?: URLSearchParams;
  sdkFactory?: DiscordSdkFactory;
  fetchImpl?: typeof fetch;
  readyTimeoutMs?: number;
  authorizeTimeoutMs?: number;
  tokenExchangeTimeoutMs?: number;
  authenticateTimeoutMs?: number;
}

export interface ActivitySessionClientOptions<TSnapshot = unknown> {
  socketUrl: string;
  identity: ActivityIdentity;
  socketOptions?: Partial<ManagerOptions & SocketOptions>;
  joinEvent?: string;
  leaveEvent?: string;
  stateEvent?: string;
  errorEvent?: string;
  syncEvents?: string[];
  makeJoinPayload?: (identity: ActivityIdentity) => JoinSessionPayload;
  onSnapshot?: (snapshot: TSnapshot) => void;
  onError?: (message: string) => void;
  onStatus?: (message: string) => void;
}

export interface ActivitySessionClient<TSnapshot = unknown> {
  socket: Socket;
  connect: () => Socket;
  leave: () => void;
  disconnect: () => void;
}

const SDK_READY_TIMEOUT_MS = 10_000;
const DISCORD_AUTHORIZE_TIMEOUT_MS = 60_000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;
const DISCORD_AUTHENTICATE_TIMEOUT_MS = 15_000;

let discordSdkPromise: Promise<DiscordSdkLike | undefined> | undefined;

export async function resolveActivityIdentity(options: ResolveActivityIdentityOptions = {}): Promise<ActivityIdentity> {
  const params = options.urlSearchParams ?? new URLSearchParams(globalThis.window?.location.search ?? "");
  const clientId = options.clientId;

  if (options.forceLocal || params.get("local") === "1" || !clientId) {
    return makeLocalIdentity({
      note: options.localFallbackNote ?? "Local browser mode. Provide a Discord client ID to initialize Activity context.",
      sessionId: options.localSessionId,
      storageKey: options.localStorageKey,
      urlSearchParams: params
    });
  }

  try {
    const sdk = await resolveDiscordSdk(clientId, options);
    if (!sdk) {
      return makeLocalIdentity({
        note: options.localFallbackNote ?? "Local browser mode. Discord SDK is unavailable.",
        sessionId: options.localSessionId,
        storageKey: options.localStorageKey,
        urlSearchParams: params
      });
    }

    const sessionId =
      params.get("session")?.trim().slice(0, 80) ||
      sdk.channelId ||
      sdk.instanceId ||
      sdk.guildId ||
      "discord-activity";

    let authenticatedUser: ActivityUser | undefined;
    let authError: string | undefined;
    try {
      authenticatedUser = await authenticateDiscordUser(sdk, clientId, options);
    } catch (error) {
      authError = describeUnknownError(error);
    }

    const user = authenticatedUser ?? sdk.user;
    if (user?.id) {
      return {
        id: user.id,
        displayName: user.global_name || user.username || "Discord Player",
        avatarUrl: discordAvatarUrl(user),
        sessionId: `discord-${sessionId}`,
        mode: "discord",
        note: authenticatedUser ? "Discord SDK authenticated." : `Discord SDK ready. OAuth fallback: ${authError ?? "using SDK user context."}`,
        discord: {
          channelId: sdk.channelId,
          guildId: sdk.guildId,
          instanceId: sdk.instanceId
        }
      };
    }

    return {
      ...makeLocalIdentity({
        note: `Discord SDK ready, but Discord identity was unavailable. ${authError ?? "OAuth did not return a user."}`,
        mode: "discord",
        sessionId: `discord-${sessionId}`,
        storageKey: options.localStorageKey,
        urlSearchParams: params
      }),
      discord: {
        channelId: sdk.channelId,
        guildId: sdk.guildId,
        instanceId: sdk.instanceId
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SDK error";
    return makeLocalIdentity({
      note: `Discord SDK unavailable: ${message}. Local fallback is active.`,
      sessionId: options.localSessionId,
      storageKey: options.localStorageKey,
      urlSearchParams: params
    });
  }
}

export function createActivitySessionClient<TSnapshot = unknown>(
  options: ActivitySessionClientOptions<TSnapshot>
): ActivitySessionClient<TSnapshot> {
  const joinEvent = options.joinEvent ?? "join_session";
  const leaveEvent = options.leaveEvent ?? "leave_session";
  const stateEvent = options.stateEvent ?? "session_state";
  const errorEvent = options.errorEvent ?? "error_message";
  const syncEvents = options.syncEvents ?? [
    stateEvent,
    "player_joined",
    "player_left",
    "score_update",
    "leaderboard_update",
    "round_countdown",
    "round_started",
    "bonus_started",
    "bonus_ended",
    "round_ended"
  ];

  const socket = io(options.socketUrl, {
    transports: ["websocket", "polling"],
    withCredentials: true,
    autoConnect: false,
    ...options.socketOptions
  });

  const joinPayload = () =>
    options.makeJoinPayload?.(options.identity) ?? {
      sessionId: options.identity.sessionId,
      player: identityToGatewayPlayer(options.identity)
    };

  const sync = (snapshot: TSnapshot) => options.onSnapshot?.(snapshot);

  socket.on("connect", () => {
    options.onStatus?.("Joining shared Activity session...");
    socket.emit(joinEvent, joinPayload(), sync);
  });

  socket.on("connect_error", () => {
    options.onError?.(`Cannot reach realtime server at ${options.socketUrl}.`);
  });

  for (const event of new Set(syncEvents)) {
    socket.on(event, sync);
  }

  socket.on(errorEvent, (message: string) => options.onError?.(message));

  return {
    socket,
    connect: () => socket.connect(),
    leave: () => {
      if (socket.connected) {
        socket.emit(leaveEvent);
      }
    },
    disconnect: () => {
      if (socket.connected) {
        socket.emit(leaveEvent);
      }
      socket.disconnect();
    }
  };
}

export function websocketUrlForIdentity(options: {
  identity: ActivityIdentity;
  remoteWsUrl: string;
  localWsUrl?: string;
  localApiBaseUrl?: string;
  urlSearchParams?: URLSearchParams;
}): string {
  const params = options.urlSearchParams ?? new URLSearchParams(globalThis.window?.location.search ?? "");
  if (options.identity.mode === "local" || params.get("local") === "1") {
    return options.localWsUrl || options.localApiBaseUrl || options.remoteWsUrl;
  }

  return options.remoteWsUrl;
}

export function subscribeToActivityLayoutMode(
  listener: (mode: ActivityLayoutMode) => void,
  options: Pick<ResolveActivityIdentityOptions, "clientId" | "forceLocal" | "urlSearchParams" | "sdkFactory" | "readyTimeoutMs"> = {}
): () => void {
  let disposed = false;
  let sdkForCleanup: DiscordSdkLike | undefined;
  let handlerForCleanup: ((update: DiscordLayoutUpdate) => unknown) | undefined;

  const clientId = options.clientId;
  if (!clientId) {
    return () => {
      disposed = true;
    };
  }

  resolveDiscordSdk(clientId, options)
    .then((sdk) => {
      if (disposed || !sdk?.subscribe) {
        return;
      }

      const handler = (update: DiscordLayoutUpdate) => {
        listener(layoutModeFromDiscord(update.layout_mode));
      };

      sdkForCleanup = sdk;
      handlerForCleanup = handler;
      sdk.subscribe("ACTIVITY_LAYOUT_MODE_UPDATE", handler).catch(() => undefined);
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    if (sdkForCleanup?.unsubscribe && handlerForCleanup) {
      sdkForCleanup.unsubscribe("ACTIVITY_LAYOUT_MODE_UPDATE", handlerForCleanup).catch(() => undefined);
    }
  };
}

async function resolveDiscordSdk(
  clientId: string,
  options: Pick<ResolveActivityIdentityOptions, "forceLocal" | "urlSearchParams" | "sdkFactory" | "readyTimeoutMs">
): Promise<DiscordSdkLike | undefined> {
  const params = options.urlSearchParams ?? new URLSearchParams(globalThis.window?.location.search ?? "");
  if (options.forceLocal || params.get("local") === "1" || !clientId) {
    return undefined;
  }

  discordSdkPromise ??= (async () => {
    const sdk = options.sdkFactory
      ? await options.sdkFactory(clientId)
      : await createDefaultDiscordSdk(clientId);
    await withTimeout(sdk.ready(), options.readyTimeoutMs ?? SDK_READY_TIMEOUT_MS, "Discord SDK ready timed out");
    sdk.commands?.setConfig?.({ use_interactive_pip: false }).catch(() => undefined);
    return sdk;
  })();

  return discordSdkPromise;
}

async function createDefaultDiscordSdk(clientId: string): Promise<DiscordSdkLike> {
  const sdkModule = await import("@discord/embedded-app-sdk");
  return new sdkModule.DiscordSDK(clientId) as DiscordSdkLike;
}

function layoutModeFromDiscord(layoutMode: number): ActivityLayoutMode {
  if (layoutMode === 0) {
    return "focused";
  }
  if (layoutMode === 1) {
    return "pip";
  }
  if (layoutMode === 2) {
    return "grid";
  }
  return "unknown";
}

async function authenticateDiscordUser(
  sdk: DiscordSdkLike,
  clientId: string,
  options: ResolveActivityIdentityOptions
): Promise<ActivityUser> {
  if (!sdk.commands?.authorize || !sdk.commands.authenticate) {
    throw new Error("Discord authorize/authenticate commands are unavailable.");
  }

  if (!options.apiBaseUrl) {
    throw new Error("Discord token exchange API base URL is not configured.");
  }

  const { code } = await withTimeout(
    sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: options.oauthState ?? "discord-activity",
      prompt: options.prompt ?? "none",
      scope: options.authorizeScopes ?? ["identify", "applications.commands"]
    }),
    options.authorizeTimeoutMs ?? DISCORD_AUTHORIZE_TIMEOUT_MS,
    "Discord authorize timed out"
  );

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await withTimeout(
    fetchImpl(`${options.apiBaseUrl}${options.tokenExchangePath ?? "/api/discord/token"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code })
    }),
    options.tokenExchangeTimeoutMs ?? TOKEN_EXCHANGE_TIMEOUT_MS,
    "Discord token exchange timed out"
  );

  const token = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    detail?: string;
  };

  if (!response.ok) {
    throw new Error(token.detail || token.error || `Discord token exchange failed with HTTP ${response.status}.`);
  }

  if (!token.access_token) {
    throw new Error("Discord token exchange did not return an access token.");
  }

  const auth = await withTimeout(
    sdk.commands.authenticate({ access_token: token.access_token }),
    options.authenticateTimeoutMs ?? DISCORD_AUTHENTICATE_TIMEOUT_MS,
    "Discord authenticate timed out"
  );

  if (!auth?.user?.id) {
    throw new Error("Discord authenticate did not return a user.");
  }

  return auth.user;
}

function identityToGatewayPlayer(identity: ActivityIdentity): GatewayPlayer {
  return {
    id: identity.id,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl
  };
}

function discordAvatarUrl(user: { id?: string; avatar?: string }): string | undefined {
  if (!user.id || !user.avatar) {
    return undefined;
  }

  if (user.avatar.startsWith("http")) {
    return user.avatar;
  }

  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" || typeof record.code === "number" ? `code ${record.code}` : undefined;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.reason === "string"
          ? record.reason
          : typeof record.error === "string"
            ? record.error
            : undefined;

    if (code || message) {
      return [code, message].filter(Boolean).join(": ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }

  return "Unknown OAuth error";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
