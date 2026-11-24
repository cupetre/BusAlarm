import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { exchangeCodeAsync, ResponseType, useAuthRequest } from 'expo-auth-session';

import {
  clearSpotifyTokens,
  getSpotifyClientId,
  loadSpotifyTokens,
  saveSpotifyTokens,
  searchTracks,
  SPOTIFY_DISCOVERY,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
  type SpotifyTrack,
} from './spotify';
import { saveAlarmSound, type AlarmSound } from './storage';
import { colors } from './theme';

// Closes the Spotify login browser tab when it redirects back to the app.
WebBrowser.maybeCompleteAuthSession();

type Props = {
  sound: AlarmSound;
  onChange: (sound: AlarmSound) => void;
  /** Song search focused; `y` is the search row's offset inside this card. */
  onSearchFocus?: (y: number) => void;
  onSearchBlur?: () => void;
};

export function AlarmSoundCard({ sound, onChange, onSearchFocus, onSearchBlur }: Props) {
  const searchRowY = useRef(0);
  const clientId = getSpotifyClientId();
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: clientId || 'missing-client-id',
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      responseType: ResponseType.Code,
      redirectUri: SPOTIFY_REDIRECT_URI,
    },
    SPOTIFY_DISCOVERY
  );

  useEffect(() => {
    loadSpotifyTokens().then((t) => setConnected(!!t));
  }, []);

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) return;
    exchangeCodeAsync(
      {
        clientId,
        code: response.params.code,
        redirectUri: SPOTIFY_REDIRECT_URI,
        extraParams: { code_verifier: request.codeVerifier },
      },
      SPOTIFY_DISCOVERY
    )
      .then(async (tok) => {
        await saveSpotifyTokens({
          accessToken: tok.accessToken,
          refreshToken: tok.refreshToken ?? '',
          expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000,
        });
        setConnected(true);
        setError(null);
      })
      .catch((e) => setError(`Spotify login failed: ${e instanceof Error ? e.message : e}`));
  }, [response, request, clientId]);

  const choose = useCallback(
    async (next: AlarmSound) => {
      await saveAlarmSound(next);
      onChange(next);
    },
    [onChange]
  );

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchTracks(query.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const disconnect = useCallback(async () => {
    await clearSpotifyTokens();
    setConnected(false);
    setResults([]);
    await choose({ type: 'siren' });
  }, [choose]);

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Alarm sound</Text>

      <View style={styles.segment}>
        <Pressable
          style={[styles.segBtn, sound.type === 'siren' && styles.segBtnActive]}
          onPress={() => choose({ type: 'siren' })}
        >
          <Text style={[styles.segText, sound.type === 'siren' && styles.segTextActive]}>Siren</Text>
        </Pressable>
        <Pressable
          style={[styles.segBtn, sound.type === 'spotify' && styles.segBtnSpotify]}
          onPress={() => {
            // Not saved until a song is picked, so the stored choice stays the siren.
            if (sound.type !== 'spotify') onChange({ type: 'spotify', uri: '', name: '', artists: '' });
          }}
        >
          <Text style={[styles.segText, sound.type === 'spotify' && styles.segTextActive]}>Spotify song</Text>
        </Pressable>
      </View>

      {sound.type === 'siren' && (
        <Text style={styles.hint}>A loud looping siren plus a vibrating notification.</Text>
      )}

      {sound.type === 'spotify' && (
        <>
          {!clientId ? (
            <Text style={styles.warn}>
              Spotify isn't set up in this build yet: it needs a Spotify Client ID in app.json.
            </Text>
          ) : !connected ? (
            <Pressable style={styles.spotifyBtn} disabled={!request} onPress={() => promptAsync()}>
              <Text style={styles.spotifyBtnText}>Connect Spotify</Text>
            </Pressable>
          ) : (
            <>
              {sound.uri ? (
                <View style={styles.trackRow}>
                  {sound.imageUrl ? <Image source={{ uri: sound.imageUrl }} style={styles.art} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackName} numberOfLines={1}>{sound.name}</Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>{sound.artists}</Text>
                  </View>
                  <Text style={styles.chosen}>Chosen</Text>
                </View>
              ) : (
                <Text style={styles.hint}>Search for the song you want to wake up to.</Text>
              )}

              <View style={styles.searchRow} onLayout={(e) => (searchRowY.current = e.nativeEvent.layout.y)}>
                <TextInput
                  style={styles.input}
                  placeholder="Search songs"
                  placeholderTextColor={colors.muted}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={runSearch}
                  onFocus={() => onSearchFocus?.(searchRowY.current)}
                  onBlur={() => onSearchBlur?.()}
                  // Keep the keyboard up after searching so you can refine;
                  // results sit right under the box, above the keyboard.
                  submitBehavior="submit"
                  returnKeyType="search"
                />
                <Pressable style={styles.searchBtn} onPress={runSearch}>
                  {searching ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.searchBtnText}>Search</Text>}
                </Pressable>
              </View>

              {results.map((t) => (
                <Pressable
                  key={t.uri}
                  style={styles.resultRow}
                  onPress={async () => {
                    Keyboard.dismiss();
                    await choose({ type: 'spotify', ...t });
                    setResults([]);
                    setQuery('');
                  }}
                >
                  {t.imageUrl ? <Image source={{ uri: t.imageUrl }} style={styles.artSmall} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackName} numberOfLines={1}>{t.name}</Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>{t.artists}</Text>
                  </View>
                </Pressable>
              ))}

              <Text style={styles.hint}>
                Needs Spotify Premium, and Spotify must be running in the background (don't swipe it
                away). If it can't play, the siren rings instead.
              </Text>
              <Pressable onPress={disconnect}>
                <Text style={styles.link}>Disconnect Spotify</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {error && <Text style={styles.warn}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 14 },
  label: { color: colors.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnActive: { backgroundColor: colors.accent },
  segBtnSpotify: { backgroundColor: colors.spotify },
  segText: { color: colors.muted, fontWeight: '700' },
  segTextActive: { color: colors.bg },
  hint: { color: colors.faint, fontSize: 12, marginTop: 10, lineHeight: 17 },
  warn: { color: '#FF8A80', fontSize: 12, marginTop: 10 },
  link: { color: colors.muted, fontSize: 12, marginTop: 10, textDecorationLine: 'underline' },
  spotifyBtn: { backgroundColor: colors.spotify, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  spotifyBtnText: { color: '#0B1220', fontWeight: '800' },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, backgroundColor: colors.cardAlt, borderRadius: 12, padding: 10 },
  art: { width: 44, height: 44, borderRadius: 6 },
  artSmall: { width: 36, height: 36, borderRadius: 4 },
  trackName: { color: colors.text, fontWeight: '600' },
  trackArtist: { color: colors.muted, fontSize: 12 },
  chosen: { color: colors.spotify, fontWeight: '700', fontSize: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: { flex: 1, backgroundColor: colors.cardAlt, color: colors.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  searchBtn: { backgroundColor: colors.spotify, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', minWidth: 76, alignItems: 'center' },
  searchBtnText: { color: '#0B1220', fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardAlt },
});
