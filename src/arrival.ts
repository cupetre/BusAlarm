import { startAlarmSound, stopAlarmSound } from './alarm';
import { pausePlayback, playTrack } from './spotify';
import { getSpotifyPlaying, loadAlarmSound, setSpotifyPlaying } from './storage';

/**
 * Starts whatever the user chose as their arrival sound. Safe to call more
 * than once (the background task and the UI both call it): the siren is
 * idempotent and the Spotify song is only started once per alarm.
 *
 * If Spotify can't play (no Premium, no device, offline, not connected), the
 * siren plays instead, so you are never left without an alarm.
 */
export async function startArrivalSound(): Promise<void> {
  const sound = await loadAlarmSound();

  if (sound.type === 'spotify') {
    if (await getSpotifyPlaying()) return; // already started for this alarm
    await setSpotifyPlaying(true);
    try {
      await playTrack(sound.uri);
      return;
    } catch (e) {
      console.warn('Spotify alarm failed, falling back to siren:', e);
      await setSpotifyPlaying(false);
    }
  }

  await startAlarmSound();
}

export async function stopArrivalSound(): Promise<void> {
  stopAlarmSound();
  if (await getSpotifyPlaying()) {
    await setSpotifyPlaying(false);
    await pausePlayback();
  }
}
