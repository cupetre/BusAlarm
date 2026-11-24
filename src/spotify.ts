import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Spotify Web API integration, used to play a chosen song when you arrive.
//
// Requirements (Spotify's rules, not ours):
// - a Spotify Premium account (playback control is Premium-only)
// - a Spotify developer app whose Client ID is in app.json -> extra.spotifyClientId,
//   with redirect URI `busalarm://spotify-auth` registered
// - the Spotify app installed on this phone and used recently, so it shows up
//   as a playback device. If it doesn't, BusAlarm falls back to the siren.

export const SPOTIFY_REDIRECT_URI = 'busalarm://spotify-auth';
export const SPOTIFY_SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];
export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const TOKENS_KEY = 'busalarm:spotifyTokens';
const API = 'https://api.spotify.com/v1';

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

export type SpotifyTrack = {
  uri: string;
  name: string;
  artists: string;
  imageUrl?: string;
};

export function getSpotifyClientId(): string {
  const id = (Constants.expoConfig?.extra as { spotifyClientId?: string } | undefined)?.spotifyClientId;
  return id ?? '';
}

export async function saveSpotifyTokens(tokens: SpotifyTokens): Promise<void> {
  await AsyncStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export async function loadSpotifyTokens(): Promise<SpotifyTokens | null> {
  const raw = await AsyncStorage.getItem(TOKENS_KEY);
  return raw ? (JSON.parse(raw) as SpotifyTokens) : null;
}

export async function clearSpotifyTokens(): Promise<void> {
  await AsyncStorage.removeItem(TOKENS_KEY);
}

async function refreshTokens(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: getSpotifyClientId(),
  });
  const res = await fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Spotify token refresh failed (${res.status})`);
  const json = await res.json();
  const next: SpotifyTokens = {
    accessToken: json.access_token,
    // PKCE refresh may or may not rotate the refresh token.
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  await saveSpotifyTokens(next);
  return next;
}

async function getAccessToken(): Promise<string> {
  let tokens = await loadSpotifyTokens();
  if (!tokens) throw new Error('Not connected to Spotify');
  if (Date.now() > tokens.expiresAt - 60_000) {
    tokens = await refreshTokens(tokens);
  }
  return tokens.accessToken;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  const res = await api(`/search?type=track&limit=8&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);
  const json = await res.json();
  return (json.tracks?.items ?? []).map((t: any) => ({
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name).join(', '),
    imageUrl: t.album?.images?.[t.album.images.length - 1]?.url ?? t.album?.images?.[0]?.url,
  }));
}

/** Picks the phone's Spotify device, falling back to whatever is active. */
async function findPlaybackDevice(): Promise<string | null> {
  const res = await api('/me/player/devices');
  if (!res.ok) {
    console.warn('[Spotify] /me/player/devices failed', res.status, await res.text());
    return null;
  }
  const { devices = [] } = await res.json();
  console.log('[Spotify] devices:', JSON.stringify(devices.map((d: any) => ({ name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted }))));
  const phone = devices.find((d: any) => d.type === 'Smartphone');
  const active = devices.find((d: any) => d.is_active);
  return (phone ?? active ?? devices[0])?.id ?? null;
}

/**
 * True when Spotify can currently play on some device. The phone only shows
 * up while the Spotify app is running (not swiped away / killed by Android).
 */
export async function isSpotifyDeviceAvailable(): Promise<boolean> {
  try {
    return (await findPlaybackDevice()) !== null;
  } catch {
    return false;
  }
}

/** Starts the track on this phone's Spotify. Throws if it can't. */
export async function playTrack(uri: string): Promise<void> {
  const deviceId = await findPlaybackDevice();
  if (!deviceId) {
    throw new Error('No Spotify device found. Open Spotify on your phone once before your trip.');
  }
  const res = await api(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify play failed (${res.status})`);
  }
}

export async function pausePlayback(): Promise<void> {
  try {
    await api('/me/player/pause', { method: 'PUT' });
  } catch {
    // Best-effort: nothing useful to do if Spotify is unreachable.
  }
}
