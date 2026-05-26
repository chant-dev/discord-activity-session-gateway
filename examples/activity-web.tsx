import { useEffect, useMemo, useState } from "react";
import {
  createActivitySessionClient,
  resolveActivityIdentity,
  subscribeToActivityLayoutMode,
  websocketUrlForIdentity,
  type ActivityIdentity,
  type ActivityLayoutMode
} from "@discord-activities/session-gateway/browser";

interface PresencePlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  connected: boolean;
  isHost: boolean;
}

interface PresenceSnapshot {
  sessionId: string;
  hostId?: string;
  players: PresencePlayer[];
  connectedPlayerCount: number;
  serverNow: number;
}

const LOCAL_API_BASE_URL = import.meta.env.VITE_LOCAL_API_BASE_URL || "http://localhost:3001";
const REMOTE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || LOCAL_API_BASE_URL;
const REMOTE_WS_URL = import.meta.env.VITE_WS_URL || REMOTE_API_BASE_URL;

export function useActivityPresenceSession() {
  const [identity, setIdentity] = useState<ActivityIdentity>();
  const [snapshot, setSnapshot] = useState<PresenceSnapshot>();
  const [status, setStatus] = useState("Initializing activity...");
  const [error, setError] = useState<string>();
  const [layoutMode, setLayoutMode] = useState<ActivityLayoutMode>("focused");
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

  useEffect(() => {
    let cancelled = false;
    setStatus("Loading Discord Activity context...");
    resolveActivityIdentity({
      clientId,
      apiBaseUrl: REMOTE_API_BASE_URL,
      oauthState: "activity-presence",
      localFallbackNote: "Local browser mode. Set VITE_DISCORD_CLIENT_ID to initialize Discord Activity context.",
      localStorageKey: "activity-presence-local-identity"
    }).then((resolvedIdentity) => {
      if (!cancelled) {
        setIdentity(resolvedIdentity);
        setStatus(resolvedIdentity.note);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(
    () => subscribeToActivityLayoutMode(setLayoutMode, { clientId }),
    [clientId]
  );

  const wsUrl = useMemo(() => {
    if (!identity) {
      return undefined;
    }

    return websocketUrlForIdentity({
      identity,
      remoteWsUrl: REMOTE_WS_URL,
      localWsUrl: import.meta.env.VITE_LOCAL_WS_URL,
      localApiBaseUrl: LOCAL_API_BASE_URL
    });
  }, [identity]);

  useEffect(() => {
    if (!identity || !wsUrl) {
      return undefined;
    }

    const session = createActivitySessionClient<PresenceSnapshot>({
      socketUrl: wsUrl,
      identity,
      onStatus: setStatus,
      onError: setError,
      onSnapshot: (nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setError(undefined);
      }
    });

    session.connect();
    return () => session.disconnect();
  }, [identity, wsUrl]);

  return {
    identity,
    snapshot,
    status,
    error,
    layoutMode
  };
}
