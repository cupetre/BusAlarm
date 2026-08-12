# BusAlarm

A private, phone-only app: set your bus stop once, start tracking, lock your
phone. When you're within range of your stop, it fires an alarm — through
your Bluetooth headphones automatically, since the OS routes audio to
whatever output is connected.

It reacts to *location*, not time, so the 20–45 minute variability in your
commute doesn't matter.

## How it works

- **Set destination** — instead of typing coordinates, ride the bus once and
  tap "Set destination = my current location" right when you get off. That
  GPS point becomes your trigger.
- **Trigger radius** — 150/300/500 m. On a moving bus GPS drifts, so 300 m is
  a reasonable default: it fires a bit before the exact stop, giving you time
  to react.
- **Start tracking** — registers an OS-level geofence (`expo-location` +
  `expo-task-manager`). This is native geofencing, not a JS loop, so it's
  battery-efficient and keeps working with the screen off.
- **On arrival** — the background task raises a loud, sticky notification
  (custom siren sound, vibration, bypasses Do Not Disturb) and also tries to
  start looping in-app audio directly. Opening the app shows a full-screen
  "STOP ALARM" button. Audio automatically comes out of your Bluetooth
  headphones if they're connected — no separate "connect to headphones" step
  needed, that's just how Android routes audio.
- **Test alarm** button lets you check the sound/vibration/notification
  chain right now, without waiting for a commute.

## Important: Android background limits (read this)

Android aggressively kills background apps to save battery, especially on
Xiaomi, Huawei, OnePlus, Oppo, and some Samsung phones. A geofence app that
gets killed won't fire. To make this reliable:

1. After installing, open **Settings → Apps → BusAlarm → Battery** and set
   it to **Unrestricted** / disable battery optimization for it.
2. On MIUI/ColorOS/etc. phones, also check for a manufacturer-specific
   "autostart" or "background activity" toggle and enable it for BusAlarm.
3. Keep BusAlarm in your recent-apps list during the commute (don't
   swipe-close it) for the first few trips until you've confirmed it
   survives your phone's battery manager.
4. Grant location as **"Allow all the time"**, not "only while using the
   app" — you'll be prompted for this when you tap Start tracking.

The notification-based fallback is best-effort: it's what most alarm/tracker
apps rely on and works on the large majority of phones once the steps above
are done, but there's no guarantee wrapped around any pure-JS Expo app that
it survives a phone that's determined to kill background processes. If you
find it's unreliable on your phone, the fix is always in that battery
settings page, not the app.

## Setup

```bash
npm install
```

### Run it for quick testing (Expo Go)

Background location/geofencing and alarm-while-locked don't fully work
inside Expo Go — it's fine for checking the UI, but for the real behavior
you need an installed build (see below).

```bash
npx expo start
```

### Build a real installable app (recommended path)

You said Android + EAS cloud build, so:

1. Create a free account at https://expo.dev if you don't have one.
2. Install the EAS CLI and log in:
   ```bash
   npm install -g eas-cli
   eas login
   ```
3. Link this project to your Expo account (creates the project on
   expo.dev and fills in the project ID for you):
   ```bash
   eas build:configure
   ```
4. Build an installable APK:
   ```bash
   eas build -p android --profile preview
   ```
   This uploads your code and builds in Expo's cloud — no Android Studio
   needed. It takes roughly 10–20 minutes. When it's done, the terminal
   (and your expo.dev dashboard) gives you a download link/QR code for the
   `.apk` file.
5. On your phone, open that link (or scan the QR code) and install the APK.
   You'll need to allow "install unknown apps" for your browser/file
   manager the first time — this is normal for any app installed outside
   the Play Store.
6. Open BusAlarm, grant location ("Allow all the time") and notification
   permissions when asked, then follow the battery-optimization steps
   above.

Every build after the first is just `eas build -p android --profile
preview` again — no need to repeat step 3.

### Updating the app later

If you tweak the code, just rerun `eas build -p android --profile preview`
and reinstall the new APK on your phone (it'll prompt to update in place
since the package name stays the same).

## Project layout

```
App.tsx                 Main UI: setup screen + full-screen alarm screen
src/geofenceTask.ts      Background task that fires on entering the geofence
src/tracking.ts          Starts/stops OS-level geofencing, permissions
src/alarm.ts             Looping alarm sound playback (expo-audio)
src/notifications.ts     Notification channel/category, arrival notification
src/storage.ts           Persists destination, tracking state, alarm state
assets/alarm.wav          Bundled alarm tone (generated beep pattern)
assets/notification-icon.png  Android status-bar icon for the alarm notification
```

Everything is local to your phone — no server, no account, no data leaving
the device beyond the location permission the OS itself manages.
