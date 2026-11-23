import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';

import './src/geofenceTask'; // registers the background task on app startup
import {
  Destination,
  getAlarmActive,
  loadDestination,
  saveDestination,
  setAlarmActive,
} from './src/storage';
import {
  getCurrentLocation,
  isTrackingActive,
  requestLocationPermissions,
  startTracking,
  stopTracking,
} from './src/tracking';
import {
  configureNotifications,
  dismissArrivalNotifications,
  requestNotificationPermission,
  STOP_ACTION_ID,
} from './src/notifications';
import { releaseAlarmSound, startAlarmSound, stopAlarmSound } from './src/alarm';

const RADIUS_OPTIONS = [150, 300, 500];

export default function App() {
  const [ready, setReady] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [radius, setRadius] = useState(300);
  const [tracking, setTracking] = useState(false);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startupErrors, setStartupErrors] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Each startup step is isolated and time-limited: a failure or hang in one
    // (e.g. a native module misbehaving) must never leave the app stuck on the
    // loading spinner. Failures are logged (visible in `adb logcat`) and shown.
    const errors: string[] = [];
    const step = async <T,>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out after 5s')), 5000)),
        ]);
      } catch (e) {
        console.error(`[BusAlarm startup] ${name} failed:`, e);
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        return fallback;
      }
    };

    (async () => {
      await step('configureNotifications', configureNotifications, undefined);
      const dest = await step('loadDestination', loadDestination, null);
      if (dest) {
        setDestination(dest);
        setRadius(dest.radius);
      }
      setTracking(await step('isTrackingActive', isTrackingActive, false));
      setAlarmRinging(await step('getAlarmActive', getAlarmActive, false));
      setStartupErrors(errors);
      setReady(true);
    })();
  }, []);

  // While the alarm flag is set (raised by the background geofence task),
  // make sure the foreground UI reflects it and the sound is looping.
  useEffect(() => {
    if (alarmRinging) {
      startAlarmSound().catch(() => {});
    } else {
      stopAlarmSound();
    }
  }, [alarmRinging]);

  // Poll the persisted alarm flag while the app is foregrounded/backgrounded,
  // since the background task and the UI run as separate JS contexts.
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const active = await getAlarmActive();
      setAlarmRinging((prev) => (prev !== active ? active : prev));
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        setAlarmRinging(await getAlarmActive());
        // The background task stops the geofence after it fires, so refresh.
        setTracking(await isTrackingActive());
      }
    });
    return () => sub.remove();
  }, []);

  const handleStopAlarm = useCallback(async () => {
    await setAlarmActive(false);
    setAlarmRinging(false);
    stopAlarmSound();
    await dismissArrivalNotifications();
  }, []);

  // Handle the "Stop alarm" notification action button.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      if (response.actionIdentifier === STOP_ACTION_ID || response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        await handleStopAlarm();
      }
    });
    return () => sub.remove();
  }, [handleStopAlarm]);

  const handleSetDestinationHere = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await requestLocationPermissions();
      if (!perm.granted) {
        Alert.alert('Permission needed', perm.reason ?? 'Location permission was denied.');
        return;
      }
      const loc = await getCurrentLocation();
      const dest: Destination = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius,
        label: 'My destination',
      };
      await saveDestination(dest);
      setDestination(dest);
      Alert.alert('Destination saved', 'This spot is now your alarm destination.');
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setBusy(false);
    }
  }, [radius]);

  const handleChangeRadius = useCallback(
    async (value: number) => {
      setRadius(value);
      if (destination) {
        const updated = { ...destination, radius: value };
        setDestination(updated);
        await saveDestination(updated);
        if (tracking) {
          await startTracking(updated); // re-register geofence with new radius
        }
      }
    },
    [destination, tracking]
  );

  const handleToggleTracking = useCallback(async () => {
    if (!destination) {
      Alert.alert('Set a destination first', 'Ride the route once, then tap "Set destination = my current location" when you arrive.');
      return;
    }
    setBusy(true);
    try {
      if (tracking) {
        await stopTracking();
        setTracking(false);
      } else {
        const perm = await requestLocationPermissions();
        if (!perm.granted) {
          Alert.alert('Permission needed', perm.reason ?? 'Location permission was denied.');
          return;
        }
        const notifGranted = await requestNotificationPermission();
        if (!notifGranted) {
          Alert.alert(
            'Notifications recommended',
            'Without notification permission, the alarm can only rely on in-app sound, which only works while the app is open.'
          );
        }
        await startTracking(destination);
        setTracking(true);
      }
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setBusy(false);
    }
  }, [destination, tracking]);

  const handleTestAlarm = useCallback(async () => {
    await setAlarmActive(true);
    setAlarmRinging(true);
  }, []);

  useEffect(() => () => releaseAlarmSound(), []);

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (alarmRinging) {
    return (
      <SafeAreaView style={styles.alarmContainer}>
        <StatusBar style="light" />
        <Text style={styles.alarmTitle}>You've arrived!</Text>
        <Text style={styles.alarmSubtitle}>Time to get off.</Text>
        <Pressable style={styles.stopButton} onPress={handleStopAlarm}>
          <Text style={styles.stopButtonText}>STOP ALARM</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>BusAlarm</Text>
      <Text style={styles.subtitle}>Wakes you up when you reach your stop.</Text>

      {startupErrors.length > 0 && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Startup problems</Text>
          {startupErrors.map((msg) => (
            <Text key={msg} style={styles.errorText}>{msg}</Text>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Destination</Text>
        {destination ? (
          <Text style={styles.cardValue}>
            {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
            {'\n'}Trigger radius: {destination.radius} m
          </Text>
        ) : (
          <Text style={styles.cardValueMuted}>Not set yet</Text>
        )}
        <Pressable style={styles.secondaryButton} onPress={handleSetDestinationHere} disabled={busy}>
          <Text style={styles.secondaryButtonText}>
            {destination ? 'Update destination = my current location' : 'Set destination = my current location'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>
          Tip: ride the bus once, and tap this button right when you get off at your usual stop.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Trigger radius</Text>
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((r) => (
            <Pressable
              key={r}
              style={[styles.radiusPill, radius === r && styles.radiusPillActive]}
              onPress={() => handleChangeRadius(r)}
            >
              <Text style={[styles.radiusPillText, radius === r && styles.radiusPillTextActive]}>{r} m</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          Larger radius = alarm fires a bit earlier, useful on a moving bus where GPS drifts.
        </Text>
      </View>

      <Pressable
        style={[styles.primaryButton, tracking && styles.primaryButtonActive]}
        onPress={handleToggleTracking}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>{tracking ? 'Stop tracking' : 'Start tracking'}</Text>
      </Pressable>

      <Pressable style={styles.testButton} onPress={handleTestAlarm}>
        <Text style={styles.testButtonText}>Test alarm now</Text>
      </Pressable>

      <Text style={styles.footerHint}>
        Once "Start tracking" is on, you can lock your phone or switch apps -- BusAlarm keeps watching your
        location in the background and will ring when you're within range of your destination.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1220',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  center: {
    flex: 1,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9AA5B1',
    marginTop: 4,
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#141C2C',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  errorCard: {
    backgroundColor: '#3A1414',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#FF8A80',
    fontWeight: '700',
    marginBottom: 4,
  },
  errorText: {
    color: '#FFCDD2',
    fontSize: 12,
  },
  cardLabel: {
    color: '#9AA5B1',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cardValue: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  cardValueMuted: {
    color: '#5C6675',
    fontSize: 16,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  secondaryButton: {
    backgroundColor: '#1E2A40',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#4FA3FF',
    fontWeight: '600',
  },
  hint: {
    color: '#5C6675',
    fontSize: 12,
    marginTop: 8,
  },
  radiusRow: {
    flexDirection: 'row',
    gap: 10,
  },
  radiusPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1E2A40',
    alignItems: 'center',
  },
  radiusPillActive: {
    backgroundColor: '#4FA3FF',
  },
  radiusPillText: {
    color: '#9AA5B1',
    fontWeight: '600',
  },
  radiusPillTextActive: {
    color: '#0B1220',
  },
  primaryButton: {
    backgroundColor: '#2ECC71',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonActive: {
    backgroundColor: '#E74C3C',
  },
  primaryButtonText: {
    color: '#0B1220',
    fontWeight: '800',
    fontSize: 16,
  },
  testButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2C3A52',
    marginBottom: 20,
  },
  testButtonText: {
    color: '#9AA5B1',
    fontWeight: '600',
  },
  footerHint: {
    color: '#5C6675',
    fontSize: 12,
    textAlign: 'center',
  },
  alarmContainer: {
    flex: 1,
    backgroundColor: '#E74C3C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  alarmTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  alarmSubtitle: {
    fontSize: 18,
    color: '#FFE5E0',
    marginBottom: 48,
  },
  stopButton: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 22,
    paddingHorizontal: 48,
  },
  stopButtonText: {
    color: '#E74C3C',
    fontWeight: '800',
    fontSize: 20,
  },
});
