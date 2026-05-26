export type ActivityIdentityMode = "discord" | "local";

export interface ActivityIdentity {
  id: string;
  displayName: string;
  avatarUrl?: string;
  sessionId: string;
  mode: ActivityIdentityMode;
  note: string;
  discord?: {
    channelId?: string;
    guildId?: string;
    instanceId?: string;
  };
}

export interface ActivityUser {
  id?: string;
  username?: string;
  global_name?: string;
  avatar?: string;
}

export interface GatewayPlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface JoinSessionPayload {
  sessionId?: string;
  player: GatewayPlayer;
}

export type ActivityLayoutMode = "focused" | "pip" | "grid" | "unknown";

export interface DiscordLayoutUpdate {
  layout_mode: number;
}

export interface DiscordSdkLike {
  ready: () => Promise<void>;
  channelId?: string;
  guildId?: string;
  instanceId?: string;
  user?: ActivityUser;
  commands?: {
    authorize?: (payload: {
      client_id: string;
      response_type: "code";
      state: string;
      prompt: "none" | "consent";
      scope: string[];
    }) => Promise<{ code: string }>;
    authenticate?: (payload: { access_token: string }) => Promise<{
      user?: ActivityUser;
      access_token?: string;
    }>;
    setConfig?: (payload: { use_interactive_pip: boolean }) => Promise<{ use_interactive_pip: boolean }>;
  };
  subscribe?: (event: "ACTIVITY_LAYOUT_MODE_UPDATE", listener: (update: DiscordLayoutUpdate) => unknown) => Promise<unknown>;
  unsubscribe?: (event: "ACTIVITY_LAYOUT_MODE_UPDATE", listener: (update: DiscordLayoutUpdate) => unknown) => Promise<unknown>;
}

export type DiscordSdkFactory = (clientId: string) => Promise<DiscordSdkLike> | DiscordSdkLike;

export interface LocalIdentityOptions {
  note: string;
  mode?: ActivityIdentityMode;
  storageKey?: string;
  sessionId?: string;
  displayName?: string;
  playerId?: string;
  urlSearchParams?: URLSearchParams;
  storage?: Storage;
  randomName?: () => string;
  randomId?: () => string;
}
