// Address search via OpenStreetMap's Nominatim service.
// Usage policy: max 1 request/second, identify the app, no search-as-you-type,
// so we only search when the user presses search.
// https://operations.osmfoundation.org/policies/nominatim/

export type Place = { name: string; latitude: number; longitude: number };

export async function searchPlaces(query: string, near?: { latitude: number; longitude: number }): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6' });
  if (near) {
    // Prefer results around the user without excluding the rest of the world.
    const d = 0.5;
    params.set('viewbox', `${near.longitude - d},${near.latitude + d},${near.longitude + d},${near.latitude - d}`);
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'User-Agent': 'BusAlarm/1.0 (personal bus-stop alarm app)', 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return json.map((r: any) => ({
    name: r.display_name as string,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
}
