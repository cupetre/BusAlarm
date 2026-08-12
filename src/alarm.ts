import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Bundled alarm tone. Looped continuously until stopAlarmSound() is called.
const ALARM_SOUND = require('../assets/alarm.wav');

let player: AudioPlayer | null = null;

/**
 * Configures the audio session so the alarm plays reliably:
 * - ignores the phone's silent/mute switch behaviour used by media apps
 * - keeps the sound routed to whatever output is active, which on Android
 *   is automatically the connected Bluetooth headphones once they're paired
 *   and connected -- no extra "connect to headphones" code is needed, the OS
 *   handles audio routing for any app that plays audio.
 */
export async function primeAudioSession(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  });
}

export async function startAlarmSound(): Promise<void> {
  await primeAudioSession();
  if (player) {
    player.play();
    return;
  }
  player = createAudioPlayer(ALARM_SOUND);
  player.loop = true;
  player.volume = 1.0;
  player.play();
}

export function stopAlarmSound(): void {
  if (player) {
    player.pause();
    player.seekTo(0);
  }
}

export function releaseAlarmSound(): void {
  if (player) {
    player.remove();
    player = null;
  }
}
