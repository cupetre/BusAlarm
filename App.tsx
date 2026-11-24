import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import './src/geofenceTask'; // registers the background task on app startup
import {
  type AlarmSound,
  Destination,
  getAlarmActive,
  loadAlarmSound,
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
import { releaseAlarmSound } from './src/alarm';
import { startArrivalSound, stopArrivalSound } from './src/arrival';
import { MapPicker, type LatLng, type MapPickerHandle } from './src/MapPicker';
import { searchPlaces, type Place } from './src/geocode';
import { AlarmSoundCard } from './src/SpotifyCard';
import { isSpotifyDeviceAvailable } from './src/spotify';
import { colors } from './src/theme';

const RADIUS_OPTIONS = [150, 300, 500];

export default function App() {
  return (
    <SafeAreaProvider>
      <BusAlarm />
    </SafeAreaProvider>
  );
}

function BusAlarm() {
  const [ready, setReady] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [radius, setRadius] = useState(300);
  const [tracking, setTracking] = useState(false);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startupErrors, setStartupErrors] = useState<string[]>([]);
  const [sound, setSound] = useState<AlarmSound>({ type: 'siren' });
  const [userCenter, setUserCenter] = useState<LatLng | undefined>();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<MapPickerHandle>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheetRef = useRef<ScrollView>(null);
  const soundCardY = useRef(0);
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [songSearchActive, setSongSearchActive] = useState(false);

  // Track the keyboard ourselves: with Android's edge-to-edge layout the
  // window no longer shrinks for the keyboard, so we pad the sheet instead.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // While typing a song search, fold the map away so the search box and its
  // results get the whole screen above the keyboard.
  const sheetExpanded = songSearchActive && keyboardHeight > 0;

  const searchRowY = useRef(0);
  const handleSongSearchFocus = useCallback((rowY: number) => {
    searchRowY.current = rowY;
    setSongSearchActive(true);
  }, []);

  // Once the keyboard is up and the map has folded away (so the sheet has its
  // extra bottom space), bring the song search box to the top of the screen.
  useEffect(() => {
    if (!sheetExpanded) return;
    const t = setTimeout(() => {
      sheetRef.current?.scrollTo({ y: Math.max(0, soundCardY.current + searchRowY.current - 12), animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [sheetExpanded, keyboardHeight]);
  const handleSongSearchBlur = useCallback(() => setSongSearchActive(false), []);

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
      setSound(await step('loadAlarmSound', loadAlarmSound, { type: 'siren' } as AlarmSound));
      setTracking(await step('isTrackingActive', isTrackingActive, false));
      setAlarmRinging(await step('getAlarmActive', getAlarmActive, false));
      // Centre the map near the user if we already have permission (no prompt).
      const last = await step(
        'lastKnownLocation',
        async () => {
          const perm = await Location.getForegroundPermissionsAsync();
          return perm.granted ? Location.getLastKnownPositionAsync() : null;
        },
        null
      );
      if (last) setUserCenter({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      setStartupErrors(errors);
      setReady(true);
    })();
  }, []);

  // While the alarm flag is set (raised by the background geofence task),
  // make sure the chosen sound is playing. Waits for startup so it can't
  // stop a song the background task just started.
  useEffect(() => {
    if (!ready) return;
    if (alarmRinging) {
      startArrivalSound().catch(() => {});
    } else {
      stopArrivalSound().catch(() => {});
    }
  }, [alarmRinging, ready]);

  // Poll the persisted alarm flag, since the background task updates it.
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const active = await getAlarmActive();
      setAlarmRinging((prev) => (prev !== active ? active : prev));
      // The geofence is one-shot (stopped by the background task on arrival),
      // so keep the Start/Stop tracking button in sync with reality.
      try {
        const isTracking = await isTrackingActive();
        setTracking((prev) => (prev !== isTracking ? isTracking : prev));
      } catch {}
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        setAlarmRinging(await getAlarmActive());
        setTracking(await isTrackingActive());
      }
    });
    return () => sub.remove();
  }, []);

  const handleStopAlarm = useCallback(async () => {
    await setAlarmActive(false);
    setAlarmRinging(false);
    await stopArrivalSound();
    await dismissArrivalNotifications();
  }, []);

  // Handle the "Stop alarm" notification action button.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      if (
        response.actionIdentifier === STOP_ACTION_ID ||
        response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
      ) {
        await handleStopAlarm();
      }
    });
    return () => sub.remove();
  }, [handleStopAlarm]);

  const applyDestination = useCallback(
    async (point: LatLng, label: string) => {
      const dest: Destination = { ...point, radius, label };
      setDestination(dest);
      await saveDestination(dest);
      if (tracking) {
        await startTracking(dest); // move the live geofence to the new pin
      }
    },
    [radius, tracking]
  );

  const handleMapPick = useCallback(
    (point: LatLng) => {
      applyDestination(point, 'Dropped pin').catch((e) => Alert.alert('Error', String(e)));
    },
    [applyDestination]
  );

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const found = await searchPlaces(q, destination ?? userCenter);
      setPlaces(found);
      if (found.length === 0) Alert.alert('No results', `Nothing found for "${q}".`);
    } catch (e) {
      Alert.alert('Search failed', String(e));
    } finally {
      setSearching(false);
    }
  }, [query, destination, userCenter]);

  const handlePlace = useCallback(
    async (place: Place) => {
      setPlaces([]);
      setQuery('');
      const point = { latitude: place.latitude, longitude: place.longitude };
      mapRef.current?.flyTo(point, 16);
      await applyDestination(point, place.name.split(',')[0]);
    },
    [applyDestination]
  );

  const handleLocateMe = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const loc = await getCurrentLocation();
      setUserCenter(loc);
      mapRef.current?.flyTo(loc, 16);
    } catch (e) {
      Alert.alert('Location unavailable', String(e));
    }
  }, []);

  const handleSetDestinationHere = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await requestLocationPermissions();
      if (!perm.granted) {
        Alert.alert('Permission needed', perm.reason ?? 'Location permission was denied.');
        return;
      }
      const loc = await getCurrentLocation();
      mapRef.current?.flyTo(loc, 16);
      await applyDestination(loc, 'My current location');
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setBusy(false);
    }
  }, [applyDestination]);

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
      Alert.alert('Pick your stop first', 'Tap the map, or search for your stop, to drop the alarm pin.');
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
        // Spotify can only start the song if its app is running in the
        // background; Android won't let us launch it at arrival time.
        if (sound.type === 'spotify' && sound.uri && !(await isSpotifyDeviceAvailable())) {
          const choice = await new Promise<'open' | 'siren' | 'cancel'>((resolve) =>
            Alert.alert(
              'Spotify isn\'t running',
              'Your song can only play if Spotify is open in the background. Open Spotify, play anything for a second, then come back and start tracking. Otherwise the siren will ring.',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
                { text: 'Use siren', onPress: () => resolve('siren') },
                { text: 'Open Spotify', onPress: () => resolve('open') },
              ]
            )
          );
          if (choice === 'open') {
            await Linking.openURL('spotify:').catch(() =>
              Alert.alert('Spotify not found', 'Install or open the Spotify app first.')
            );
          }
          if (choice !== 'siren') return;
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
  }, [destination, tracking, sound]);

  const handleTestAlarm = useCallback(async () => {
    await setAlarmActive(true);
    setAlarmRinging(true);
  }, []);

  useEffect(() => () => releaseAlarmSound(), []);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (alarmRinging) {
    return (
      <SafeAreaView style={styles.alarmContainer}>
        <StatusBar style="light" />
        <Text style={styles.alarmTitle}>You've arrived!</Text>
        <Text style={styles.alarmSubtitle}>Time to get off.</Text>
        {sound.type === 'spotify' && sound.uri ? (
          <View style={styles.alarmTrack}>
            {sound.imageUrl ? <Image source={{ uri: sound.imageUrl }} style={styles.alarmArt} /> : null}
            <Text style={styles.alarmTrackText} numberOfLines={1}>
              {sound.name} · {sound.artists}
            </Text>
          </View>
        ) : null}
        <Pressable style={styles.stopButton} onPress={handleStopAlarm}>
          <Text style={styles.stopButtonText}>STOP ALARM</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Map with the search bar floating on top */}
      <View style={[styles.mapArea, sheetExpanded && styles.mapAreaHidden]}>
        <MapPicker
          ref={mapRef}
          pin={destination ? { latitude: destination.latitude, longitude: destination.longitude } : null}
          radius={radius}
          onPick={handleMapPick}
          initialCenter={userCenter}
        />

        <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
          <View style={styles.headerRow} pointerEvents="none">
            <Text style={styles.title}>BusAlarm</Text>
            <View style={[styles.statusPill, tracking && styles.statusPillOn]}>
              <View style={[styles.statusDot, tracking && styles.statusDotOn]} />
              <Text style={styles.statusText}>{tracking ? 'Tracking' : 'Idle'}</Text>
            </View>
          </View>

          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search for your stop or address"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            <Pressable style={styles.searchButton} onPress={handleSearch}>
              {searching ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.searchButtonText}>Go</Text>
              )}
            </Pressable>
          </View>

          {places.length > 0 && (
            <View style={styles.results}>
              {places.map((p) => (
                <Pressable key={`${p.latitude},${p.longitude}`} style={styles.resultRow} onPress={() => handlePlace(p)}>
                  <Text style={styles.resultMain} numberOfLines={1}>{p.name.split(',')[0]}</Text>
                  <Text style={styles.resultSub} numberOfLines={1}>{p.name.split(',').slice(1).join(',').trim()}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </SafeAreaView>

        <Pressable style={styles.locateButton} onPress={handleLocateMe}>
          <View style={styles.locateIcon} />
        </Pressable>
      </View>

      {/* Settings sheet */}
      {/* Solid strip behind the status bar while the map is folded away */}
      {sheetExpanded && <View style={{ height: insets.top, backgroundColor: colors.bg }} />}
      <ScrollView
        ref={sheetRef}
        style={[styles.sheet, sheetExpanded && { marginTop: 0, borderRadius: 0 }]}
        contentContainerStyle={[styles.sheetContent, { paddingBottom: 40 + keyboardHeight }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.handle} />

        {startupErrors.length > 0 && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Startup problems</Text>
            {startupErrors.map((msg) => (
              <Text key={msg} style={styles.errorText}>{msg}</Text>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Your stop</Text>
          {destination ? (
            <>
              <Text style={styles.cardValue} numberOfLines={1}>{destination.label}</Text>
              <Text style={styles.coords}>
                {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
              </Text>
            </>
          ) : (
            <Text style={styles.cardValueMuted}>Tap the map or search to drop the pin</Text>
          )}
          <Pressable style={styles.secondaryButton} onPress={handleSetDestinationHere} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Use my current location</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Ring when within</Text>
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
          <Text style={styles.hint}>Bigger circle = earlier alarm. 300 m suits a moving bus.</Text>
        </View>

        <View onLayout={(e) => (soundCardY.current = e.nativeEvent.layout.y)}>
          <AlarmSoundCard
            sound={sound}
            onChange={setSound}
            onSearchFocus={handleSongSearchFocus}
            onSearchBlur={handleSongSearchBlur}
          />
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
          Once tracking is on you can lock your phone. BusAlarm rings when you enter the circle.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },

  mapArea: { height: '46%', backgroundColor: colors.bg },
  mapAreaHidden: { height: 0, overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(20,28,44,0.9)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusPillOn: { backgroundColor: 'rgba(46,204,113,0.2)' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
  statusDotOn: { backgroundColor: colors.go },
  statusText: { color: colors.text, fontWeight: '700', fontSize: 12 },

  searchBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(20,28,44,0.96)',
    borderRadius: 14,
    padding: 5,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  searchInput: { flex: 1, color: colors.text, paddingHorizontal: 10, fontSize: 15 },
  searchButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 52,
  },
  searchButtonText: { color: colors.bg, fontWeight: '800' },
  results: { backgroundColor: 'rgba(20,28,44,0.98)', borderRadius: 14, marginTop: 6, overflow: 'hidden', elevation: 6 },
  resultRow: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardAlt },
  resultMain: { color: colors.text, fontWeight: '600' },
  resultSub: { color: colors.muted, fontSize: 12, marginTop: 2 },

  locateButton: {
    position: 'absolute',
    right: 16,
    bottom: 30,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(20,28,44,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  locateIcon: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.accent },

  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    marginTop: -18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 40 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.cardAlt, marginVertical: 10 },

  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 14 },
  cardLabel: { color: colors.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  cardValue: { color: colors.text, fontSize: 17, fontWeight: '700' },
  coords: { color: colors.faint, fontSize: 12, marginTop: 2, marginBottom: 12 },
  cardValueMuted: { color: colors.faint, fontSize: 15, marginBottom: 12, fontStyle: 'italic' },
  secondaryButton: { backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  secondaryButtonText: { color: colors.accent, fontWeight: '600' },
  hint: { color: colors.faint, fontSize: 12, marginTop: 10 },

  radiusRow: { flexDirection: 'row', gap: 10 },
  radiusPill: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center' },
  radiusPillActive: { backgroundColor: colors.pin },
  radiusPillText: { color: colors.muted, fontWeight: '700' },
  radiusPillTextActive: { color: colors.text },

  primaryButton: { backgroundColor: colors.go, borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginBottom: 12 },
  primaryButtonActive: { backgroundColor: colors.danger },
  primaryButtonText: { color: colors.bg, fontWeight: '800', fontSize: 17 },
  testButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardAlt,
    marginBottom: 16,
  },
  testButtonText: { color: colors.muted, fontWeight: '600' },
  footerHint: { color: colors.faint, fontSize: 12, textAlign: 'center' },

  errorCard: { backgroundColor: '#3A1414', borderRadius: 12, padding: 12, marginBottom: 14 },
  errorTitle: { color: '#FF8A80', fontWeight: '700', marginBottom: 4 },
  errorText: { color: '#FFCDD2', fontSize: 12 },

  alarmContainer: {
    flex: 1,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  alarmTitle: { fontSize: 36, fontWeight: '800', color: '#fff', marginBottom: 8, textAlign: 'center' },
  alarmSubtitle: { fontSize: 18, color: '#FFE5E0', marginBottom: 28 },
  alarmTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 999,
    paddingRight: 16,
    marginBottom: 36,
    maxWidth: '100%',
  },
  alarmArt: { width: 40, height: 40, borderRadius: 20 },
  alarmTrackText: { color: '#fff', fontWeight: '600', flexShrink: 1 },
  stopButton: { backgroundColor: '#fff', borderRadius: 999, paddingVertical: 22, paddingHorizontal: 48 },
  stopButtonText: { color: colors.danger, fontWeight: '800', fontSize: 20 },
});
