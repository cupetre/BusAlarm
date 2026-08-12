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
