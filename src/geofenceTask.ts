import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { presentArrivalNotification } from './notifications';
import { setAlarmActive, setTrackingFlag } from './storage';
import { startAlarmSound } from './alarm';

export const GEOFENCE_TASK = 'busalarm-destination-geofence';

// This task is registered with the OS via Location.startGeofencingAsync().
// Android/iOS will wake the app process and invoke this callback whenever the
// device crosses into (or out of) the destination radius -- this works even
// if the app is backgrounded, and on Android it generally still fires if the
// app was swiped away, as long as the OS hasn't force-killed the process
// (see the README section on battery-optimization exemptions).
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('Geofence task error:', error.message);
    return;
  }

  const { eventType, region } = (data ?? {}) as {
    eventType?: Location.GeofencingEventType;
    region?: Location.LocationRegion;
  };

  if (eventType === Location.GeofencingEventType.Enter) {
    await setAlarmActive(true);
    // One-shot: stop watching once we've arrived so the alarm doesn't re-fire
    // if GPS drifts out of and back into the radius.
    try {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
      await setTrackingFlag(false);
    } catch (e) {
      console.warn('Could not stop geofencing after arrival:', e);
    }
    // Best-effort: show a loud, sticky notification immediately. This is the
    // most reliable wake-up signal when the app isn't in the foreground.
    await presentArrivalNotification();
    // Best-effort: also try to start looping playback directly. This works
    // when the app is open or recently backgrounded; if the OS has fully
    // suspended the JS runtime, the notification above is the fallback.
    try {
      await startAlarmSound();
    } catch (e) {
      console.warn('Could not start alarm sound from background task:', e);
    }
  }
});
