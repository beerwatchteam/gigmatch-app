/**
 * Australian suburb/postcode search — ported from the Twaylo web app.
 * Data: assets/ausSuburbs.json (~1.5 MB, bundled and cached after first require).
 */

type SuburbRecord = {
  name: string;
  state: string;
  postcode: string;
  lat: number;
  lng: number;
};

export type AreaResult = {
  label: string;
  lat: number;
  lng: number;
};

// ── Levenshtein fuzzy ────────────────────────────────────────────────

function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const m = a.length, n = b.length;
  let row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    let rowMin = row[0];
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j - 1], row[j]);
      prev = row[j];
      row[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return row[n];
}

function editThreshold(len: number): number {
  return len < 6 ? 1 : 2;
}

function fuzzyMatch(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase().trim();
  const h = haystack.toLowerCase();
  if (!n) return true;
  if (h.includes(n)) return true;
  const needleWords   = n.split(/\s+/).filter(Boolean);
  const haystackWords = h.split(/\W+/).filter(Boolean);
  return needleWords.every(nw =>
    haystackWords.some(hw => {
      if (hw.includes(nw) || nw.includes(hw)) return true;
      const t = editThreshold(nw.length);
      return levenshtein(nw, hw, t) <= t;
    }),
  );
}

// ── Data (cached after first require) ───────────────────────────────

let _suburbs: SuburbRecord[] | null = null;

function getSuburbs(): SuburbRecord[] {
  if (!_suburbs) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _suburbs = require('../assets/ausSuburbs.json') as SuburbRecord[];
  }
  return _suburbs;
}

// ── Main search ──────────────────────────────────────────────────────

export function searchSuburbs(query: string, limit = 6): AreaResult[] {
  const q = query.trim();
  if (!q) return [];

  const suburbs = getSuburbs();
  const ql = q.toLowerCase();

  if (/^\d+$/.test(q)) {
    return suburbs
      .filter(s => s.postcode?.startsWith(q))
      .slice(0, limit)
      .map(toResult);
  }

  const prefix: SuburbRecord[]   = [];
  const contains: SuburbRecord[] = [];
  const fuzzy: SuburbRecord[]    = [];

  for (const s of suburbs) {
    const nameLower = s.name.toLowerCase();
    if (nameLower.startsWith(ql)) {
      prefix.push(s);
    } else if (nameLower.includes(ql)) {
      contains.push(s);
    } else if (fuzzy.length < 20 && fuzzyMatch(ql, s.name)) {
      fuzzy.push(s);
    }
    if (prefix.length >= limit) break;
  }

  const combined = [...prefix, ...contains, ...fuzzy];
  const seen = new Set<string>();
  const out: AreaResult[] = [];
  for (const s of combined) {
    const key = `${s.name}|${s.postcode}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(toResult(s));
      if (out.length >= limit) break;
    }
  }
  return out;
}

function toResult(s: SuburbRecord): AreaResult {
  return { label: `${s.name}, ${s.state}, ${s.postcode}`, lat: s.lat, lng: s.lng };
}

// ── Haversine distance (km) ──────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
