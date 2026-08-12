import * as Location from 'expo-location';
import { GEOFENCE_TASK } from './geofenceTask';
import { Destination, setTrackingFlag } from './storage';

export type PermissionResult = {
  granted: boolean;
  reason?: string;
};

export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { granted: false, reason: 'Foreground location permission was denied.' };
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    return {
      granted: false,
      reason:
        'Background location permission was denied. Without "Allow all the time", the alarm cannot fire while your phone is locked or the app is in the background.',
    };
  }

  return { granted: true };
}

export async function startTracking(destination: Destination): Promise<void> {
  const already = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (already) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }

  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    {
      identifier: 'destination',
      latitude: destination.latitude,
      longitude: destination.longitude,
      radius: destination.radius,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
  ]);

  await setTrackingFlag(true);
}

export async function stopTracking(): Promise<void> {
  const already = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (already) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
  await setTrackingFlag(false);
}

export async function isTrackingActive(): Promise<boolean> {
  return Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
}

export async function getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}
