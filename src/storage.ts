import AsyncStorage from '@react-native-async-storage/async-storage';

export type Destination = {
  latitude: number;
  longitude: number;
  radius: number; // meters
  label: string;
};

const DESTINATION_KEY = 'busalarm:destination';
const TRACKING_KEY = 'busalarm:tracking';
const ALARM_ACTIVE_KEY = 'busalarm:alarmActive';

export async function saveDestination(dest: Destination): Promise<void> {
  await AsyncStorage.setItem(DESTINATION_KEY, JSON.stringify(dest));
}

export async function loadDestination(): Promise<Destination | null> {
  const raw = await AsyncStorage.getItem(DESTINATION_KEY);
  return raw ? (JSON.parse(raw) as Destination) : null;
}

export async function setTrackingFlag(isTracking: boolean): Promise<void> {
  await AsyncStorage.setItem(TRACKING_KEY, isTracking ? '1' : '0');
}

export async function getTrackingFlag(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(TRACKING_KEY);
  return raw === '1';
}

export async function setAlarmActive(isActive: boolean): Promise<void> {
  await AsyncStorage.setItem(ALARM_ACTIVE_KEY, isActive ? '1' : '0');
}

export async function getAlarmActive(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ALARM_ACTIVE_KEY);
  return raw === '1';
}

export type AlarmSound =
  | { type: 'siren' }
  | { type: 'spotify'; uri: string; name: string; artists: string; imageUrl?: string };

const ALARM_SOUND_KEY = 'busalarm:alarmSound';
const SPOTIFY_PLAYING_KEY = 'busalarm:spotifyPlaying';

export async function saveAlarmSound(sound: AlarmSound): Promise<void> {
  await AsyncStorage.setItem(ALARM_SOUND_KEY, JSON.stringify(sound));
}

export async function loadAlarmSound(): Promise<AlarmSound> {
  const raw = await AsyncStorage.getItem(ALARM_SOUND_KEY);
  return raw ? (JSON.parse(raw) as AlarmSound) : { type: 'siren' };
}

// Set while BusAlarm has started (or is starting) the Spotify song, so the
// background task and the UI don't both start it, and Stop knows to pause it.
export async function setSpotifyPlaying(isPlaying: boolean): Promise<void> {
  await AsyncStorage.setItem(SPOTIFY_PLAYING_KEY, isPlaying ? '1' : '0');
}

export async function getSpotifyPlaying(): Promise<boolean> {
  return (await AsyncStorage.getItem(SPOTIFY_PLAYING_KEY)) === '1';
}
