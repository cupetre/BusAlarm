import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// OpenStreetMap picker: Leaflet running inside a WebView, with free
// OpenStreetMap-based tiles from CARTO. No API key or native map SDK needed.
// Tap or long-press to drop the alarm pin, drag the pin to fine-tune it.

export type LatLng = { latitude: number; longitude: number };

export type MapPickerHandle = {
  flyTo: (point: LatLng, zoom?: number) => void;
};

type Props = {
  pin: LatLng | null;
  radius: number;
  onPick: (point: LatLng) => void;
  initialCenter?: LatLng;
};

// Default view (central Europe) until we know where the user is.
const FALLBACK_CENTER: LatLng = { latitude: 46.05, longitude: 14.5 };

const html = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #0B1220; }
  .leaflet-control-attribution { background: rgba(11,18,32,.7) !important; color: #5C6675; font-size: 9px; }
  .leaflet-control-attribution a { color: #9AA5B1; }
  .pin { width: 22px; height: 22px; border-radius: 50%; background: #FF4D3D;
         border: 3px solid #fff; box-shadow: 0 0 0 6px rgba(255,77,61,.25), 0 2px 8px rgba(0,0,0,.6); }
</style>
</head><body><div id="map"></div>
<script>
  const post = (msg) => window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  const map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  let marker = null, circle = null, radius = 300;
  const icon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });

  function setPin(lat, lng, r) {
    radius = r || radius;
    if (!marker) {
      marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); circle.setLatLng(p); post({ type: 'pick', lat: p.lat, lng: p.lng }); });
      circle = L.circle([lat, lng], { radius, color: '#FF4D3D', weight: 2, fillColor: '#FF4D3D', fillOpacity: 0.12 }).addTo(map);
    } else {
      marker.setLatLng([lat, lng]);
      circle.setLatLng([lat, lng]);
      circle.setRadius(radius);
    }
  }
  function pick(e) { setPin(e.latlng.lat, e.latlng.lng); post({ type: 'pick', lat: e.latlng.lat, lng: e.latlng.lng }); }
  map.on('click', pick);
  map.on('contextmenu', pick);

  window.busalarm = {
    init(center, pin, r) {
      map.setView([center.lat, center.lng], pin ? 15 : 13);
      if (pin) setPin(pin.lat, pin.lng, r);
      radius = r;
    },
    setPin(lat, lng, r) { setPin(lat, lng, r); },
    setRadius(r) { radius = r; if (circle) circle.setRadius(r); },
    flyTo(lat, lng, z) { map.flyTo([lat, lng], z || 16, { duration: 0.8 }); },
  };
  post({ type: 'ready' });
</script></body></html>`;

export const MapPicker = forwardRef<MapPickerHandle, Props>(function MapPicker(
  { pin, radius, onPick, initialCenter },
  ref
) {
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);

  const run = useCallback((js: string) => {
    if (ready.current) webRef.current?.injectJavaScript(`${js};true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo: (p, zoom) => run(`busalarm.flyTo(${p.latitude}, ${p.longitude}, ${zoom ?? 16})`),
  }));

  // Keep the pin and circle in sync with the app's state.
  useEffect(() => {
    if (pin) run(`busalarm.setPin(${pin.latitude}, ${pin.longitude}, ${radius})`);
  }, [pin, radius, run]);
  useEffect(() => {
    run(`busalarm.setRadius(${radius})`);
  }, [radius, run]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        ready.current = true;
        const c = pin ?? initialCenter ?? FALLBACK_CENTER;
        const pinJs = pin ? `{lat:${pin.latitude},lng:${pin.longitude}}` : 'null';
        webRef.current?.injectJavaScript(
          `busalarm.init({lat:${c.latitude},lng:${c.longitude}}, ${pinJs}, ${radius});true;`
        );
      } else if (msg.type === 'pick') {
        onPick({ latitude: msg.lat, longitude: msg.lng });
      }
    },
    [pin, initialCenter, radius, onPick]
  );

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: 'https://busalarm.app/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        style={styles.web}
        // Let the map own pan/zoom gestures.
        nestedScrollEnabled
        overScrollMode="never"
        setBuiltInZoomControls={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#0B1220' },
  web: { flex: 1, backgroundColor: '#0B1220' },
});
