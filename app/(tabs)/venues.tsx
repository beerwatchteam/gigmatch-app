import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
  ScrollView, Platform, Animated, Modal, Dimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { searchSuburbs, haversineKm, type AreaResult } from '@/lib/suburbSearch';
import { useTheme } from '@/lib/theme-context';

const GENRES = [
  'Rock', 'Jazz', 'Blues', 'Pop', 'Indie', 'Electronic / DJ',
  'Hip-Hop', 'Country', 'Acoustic / Folk', 'Cover Bands',
  'Original', 'Classical', 'Metal', 'Other',
];

const FEE_RANGES = [
  { key: '0-300',    label: '$0–$300' },
  { key: '300-500',  label: '$300–$500' },
  { key: '500-1000', label: '$500–$1,000' },
  { key: '1000+',    label: '$1,000+' },
];

const CAPACITY_OPTIONS = [
  { value: 'any',     label: 'Any size' },
  { value: 'u50',     label: 'Under 50' },
  { value: '50-150',  label: '50–150' },
  { value: '150-300', label: '150–300' },
  { value: '300+',    label: '300+' },
];

const RADIUS_OPTIONS = [1, 2, 5, 10];

function daysOfWeekInRange(dateStart: string, dateEnd: string) {
  const days = new Set<string>();
  const start  = new Date(dateStart);
  const end    = dateEnd ? new Date(dateEnd) : new Date(dateStart);
  const cursor = new Date(start);
  while (cursor <= end && days.size < 7) {
    days.add(cursor.toLocaleDateString('en-US', { weekday: 'long' }));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function countOpenSlotsForRange(venue: any, dateStart: string, dateEnd: string) {
  if (!venue.slots || Object.keys(venue.slots).length === 0) return 0;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let start: Date, end: Date;
  if (dateStart) {
    start = new Date(dateStart);
    end   = dateEnd ? new Date(dateEnd) : new Date(dateStart);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  const weekdayCounts: Record<string, number> = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = DAY_NAMES[cursor.getDay()];
    weekdayCounts[day] = (weekdayCounts[day] || 0) + 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  let total = 0;
  for (const [day, occurrences] of Object.entries(weekdayCounts)) {
    const openCount = ((venue.slots[day] || []) as { status: string }[]).filter(s => s.status === 'open').length;
    total += openCount * occurrences;
  }
  return total;
}

type Venue = {
  id: string; name: string;
  suburb?: string; state?: string; streetAddress?: string;
  description?: string; genre?: string[]; genres?: string[];
  photoUrl?: string; photos?: string[];
  photoPosition?: { x: number; y: number };
  capacity?: number; feeMin?: number; feeMax?: number;
  slots?: Record<string, { status: string }[]>;
  settings?: { listed?: boolean };
};

const CARD_H = 160;
function CardPhoto({ uri, position }: { uri: string; position?: { x: number; y: number } }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };
  useEffect(() => { Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {}); }, [uri]);
  const scale = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, CARD_H / dims.nh) : 1;
  const dispW = dims.nw ? dims.nw * scale : (w || 300);
  const dispH = dims.nh ? dims.nh * scale : CARD_H;
  const maxTx = Math.max(0, dispW - w);
  const maxTy = Math.max(0, dispH - CARD_H);
  return (
    <View style={{ width: '100%', height: CARD_H, overflow: 'hidden' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Image
        source={{ uri }}
        style={{ position: 'absolute', top: 0, left: 0, width: dispW, height: dispH,
          transform: [{ translateX: -(pos.x / 100) * maxTx }, { translateY: -(pos.y / 100) * maxTy }] } as any}
        resizeMode="cover"
      />
    </View>
  );
}

const isWeb  = Platform.OS === 'web';
const PANEL_W = Dimensions.get('window').width * 0.87;

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DOW    = ['M','T','W','T','F','S','S'];

function toLocalStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseLocal(s: string) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function CalIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View style={{ position:'absolute', top: 3, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderColor: color, borderRadius: 2 }} />
      <View style={{ position:'absolute', top: 3, left: 0, right: 0, height: 6, borderBottomWidth: 1.5, borderColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
      <View style={{ position:'absolute', top: 0, left: 4, width: 2, height: 6, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position:'absolute', top: 0, right: 4, width: 2, height: 6, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

function CalendarPicker({ value, onChange, minDate, colors: c }: {
  value: string; onChange: (v: string) => void; minDate?: string; colors: any;
}) {
  const today    = new Date();
  const todayStr = toLocalStr(today);
  const [open, setOpen]           = useState(false);
  const [viewYear, setViewYear]   = useState(() => (value ? parseLocal(value) : today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value ? parseLocal(value) : today).getMonth());

  function handleOpen() {
    const d = value ? parseLocal(value) : today;
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
    setOpen(o => !o);
  }
  function prevMonth() {
    setViewMonth(m => { if (m === 0) { setViewYear(y => y-1); return 11; } return m-1; });
  }
  function nextMonth() {
    setViewMonth(m => { if (m === 11) { setViewYear(y => y+1); return 0; } return m+1; });
  }
  function pick(dateStr: string) { onChange(dateStr); setOpen(false); }

  // Build 42-cell grid (Mon-first)
  const cells: { date: Date; in: boolean }[] = [];
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  for (let i = startOffset-1; i >= 0; i--) cells.push({ date: new Date(viewYear, viewMonth, -i), in: false });
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(viewYear, viewMonth, d), in: true });
  for (let n = 1; cells.length < 42; n++) cells.push({ date: new Date(viewYear, viewMonth+1, n), in: false });

  const display = value ? value.split('-').reverse().join('/') : '';

  return (
    <View>
      <TouchableOpacity
        style={[cal.input, { backgroundColor: c.bgFaint, borderColor: open ? Colors.orange : c.border }]}
        onPress={handleOpen} activeOpacity={0.8}
      >
        <Text style={[cal.inputText, { color: value ? c.black : '#999999' }]}>{display || 'dd/mm/yyyy'}</Text>
        <CalIcon color={open ? Colors.orange : c.grey} />
      </TouchableOpacity>

      {open && (
        <View style={[cal.dropdown, { backgroundColor: c.bg, borderColor: c.border }]}>
          <View style={cal.calHeader}>
            <Text style={[cal.monthYear, { color: c.black }]}>{CAL_MONTHS[viewMonth]} {viewYear} ▾</Text>
            <View style={{ flexDirection:'row', gap: 16 }}>
              <TouchableOpacity onPress={prevMonth}><Text style={[cal.navArrow, { color: c.black }]}>↑</Text></TouchableOpacity>
              <TouchableOpacity onPress={nextMonth}><Text style={[cal.navArrow, { color: c.black }]}>↓</Text></TouchableOpacity>
            </View>
          </View>

          <View style={cal.dowRow}>
            {CAL_DOW.map((d,i) => (
              <View key={i} style={cal.dowCell}>
                <Text style={[cal.dowText, { color: c.grey }]}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={cal.grid}>
            {cells.map((cell, i) => {
              const s = toLocalStr(cell.date);
              const selected = s === value;
              const isToday  = s === todayStr;
              const disabled = !!(minDate && s < minDate);
              return (
                <TouchableOpacity
                  key={i} style={[cal.cell, selected && cal.cellSelected]}
                  onPress={() => !disabled && pick(s)} disabled={disabled} activeOpacity={0.7}
                >
                  <Text style={[
                    cal.cellText,
                    { color: cell.in ? c.black : c.greyLight },
                    selected && { color: '#fff', fontWeight: '700' },
                    isToday && !selected && { color: Colors.orange, fontWeight: '700' },
                    disabled && { opacity: 0.3 },
                  ]}>
                    {cell.date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[cal.footer, { borderTopColor: c.borderFaint }]}>
            <TouchableOpacity onPress={() => { onChange(''); setOpen(false); }}>
              <Text style={cal.footerBtn}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pick(todayStr)}>
              <Text style={cal.footerBtn}>Today</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const cal = StyleSheet.create({
  input:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderWidth:1, borderRadius:10, paddingHorizontal:12, paddingVertical:10, gap:8 },
  inputText:   { fontSize:14, flex:1 },
  dropdown:    { borderWidth:1, borderRadius:12, marginTop:6, padding:12, zIndex:100 },
  calHeader:   { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  monthYear:   { fontSize:15, fontWeight:'700' },
  navArrow:    { fontSize:16, fontWeight:'600', paddingHorizontal:4 },
  dowRow:      { flexDirection:'row', marginBottom:4 },
  dowCell:     { flex:1, alignItems:'center', paddingVertical:4 },
  dowText:     { fontSize:12, fontWeight:'600' },
  grid:        { flexDirection:'row', flexWrap:'wrap' },
  cell:        { width:`${100/7}%` as any, aspectRatio:1, alignItems:'center', justifyContent:'center', borderRadius:4 },
  cellSelected:{ backgroundColor: Colors.orange },
  cellText:    { fontSize:13 },
  footer:      { flexDirection:'row', justifyContent:'space-between', marginTop:10, paddingTop:10, borderTopWidth:1 },
  footerBtn:   { fontSize:14, fontWeight:'600', color: Colors.orange },
});

export default function VenuesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [venues, setVenues]         = useState<Venue[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]                   = useState('');
  const [genres, setGenres]                   = useState<string[]>([]);
  const [feeRanges, setFeeRanges]             = useState<string[]>([]);
  const [dateStart, setDateStart]             = useState('');
  const [dateEnd, setDateEnd]                 = useState('');
  const [capacity, setCapacity]               = useState('any');
  const [showDropdown, setShowDropdown]       = useState(false);
  const [areaSuggestions, setAreaSuggestions] = useState<AreaResult[]>([]);
  const [locationCoords, setLocationCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius]                   = useState<number | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const slideAnim   = useRef(new Animated.Value(-PANEL_W)).current;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'venues'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Venue[];
      setVenues(all.filter(v => v.settings?.listed !== false));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = locationCoords ? '' : search.trim();
    if (q.length < 2) { setAreaSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      try {
        const areas = searchSuburbs(q, 6);
        setAreaSuggestions(areas);
        if (areas.length > 0) setShowDropdown(true);
      } catch { setAreaSuggestions([]); }
    }, 200);
  }, [search, locationCoords]);

  const q = search.trim().toLowerCase();
  const venueMatches = !locationCoords && q.length >= 2
    ? venues.filter(v => v.name?.toLowerCase().includes(q) || v.suburb?.toLowerCase().includes(q)).slice(0, 4)
    : [];
  const hasDropdown = venueMatches.length > 0 || areaSuggestions.length > 0;

  function resetFilters() {
    setSearch(''); setGenres([]); setFeeRanges([]);
    setDateStart(''); setDateEnd(''); setCapacity('any');
    setShowDropdown(false); setAreaSuggestions([]);
    setLocationCoords(null); setRadius(null);
  }

  function openFilterPanel() {
    slideAnim.setValue(-PANEL_W);
    setShowFilterPanel(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }
  function closeFilterPanel() {
    Animated.timing(slideAnim, { toValue: -PANEL_W, duration: 200, useNativeDriver: true }).start(() => setShowFilterPanel(false));
  }

  function handleSearchChange(val: string) {
    setSearch(val); setLocationCoords(null); setRadius(null);
    setShowDropdown(val.trim().length >= 2);
  }

  function selectVenueMatch(v: Venue) {
    setSearch(v.name); setLocationCoords(null); setRadius(null);
    setAreaSuggestions([]); setShowDropdown(false);
  }

  function selectAreaSuggestion(s: AreaResult) {
    setSearch(s.label); setLocationCoords({ lat: s.lat, lng: s.lng });
    setRadius(prev => prev ?? 1); setAreaSuggestions([]); setShowDropdown(false);
  }

  function clearSearch() {
    setSearch(''); setLocationCoords(null); setRadius(null);
    setAreaSuggestions([]); setShowDropdown(false);
  }

  function formatDateDisplay(iso: string) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function toggleFee(key: string) {
    setFeeRanges(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  const filtered = venues.filter(v => {
    // Location radius
    if (locationCoords && radius) {
      const vLat = (v as any).coordinates?.lat ?? null;
      const vLng = (v as any).coordinates?.lng ?? null;
      if (vLat == null || vLng == null) return false;
      if (haversineKm(locationCoords.lat, locationCoords.lng, vLat, vLng) > radius) return false;
    } else if (search.trim() && !locationCoords) {
      const q2 = search.trim().toLowerCase();
      const match =
        v.name?.toLowerCase().includes(q2) ||
        v.suburb?.toLowerCase().includes(q2) ||
        (v as any).postcode?.includes(q2) ||
        (v as any).username?.toLowerCase().includes(q2);
      if (!match) return false;
    }
    // Genre
    if (genres.length > 0) {
      const vg: string[] = (v as any).genres || v.genre || [];
      if (!genres.some(g => vg.includes(g))) return false;
    }
    // Fee ranges
    if (feeRanges.length > 0) {
      const vLo = v.feeMin ?? null; const vHi = v.feeMax ?? null;
      if (vLo === null && vHi === null) return false;
      const lo = vLo ?? 0; const hi = vHi ?? Infinity;
      const ok = feeRanges.some(key => {
        if (key === '0-300')    return hi >= 0    && lo <= 300;
        if (key === '300-500')  return hi >= 300  && lo <= 500;
        if (key === '500-1000') return hi >= 500  && lo <= 1000;
        if (key === '1000+')    return hi >= 1000;
        return false;
      });
      if (!ok) return false;
    }
    // Capacity
    if (capacity !== 'any') {
      const cap = v.capacity ?? null;
      if (cap === null) return false;
      const opt = CAPACITY_OPTIONS.find(o => o.value === capacity);
      if (opt) {
        if (opt.value === 'u50'     && cap >= 50)               return false;
        if (opt.value === '50-150'  && (cap < 50  || cap > 150)) return false;
        if (opt.value === '150-300' && (cap < 150 || cap > 300)) return false;
        if (opt.value === '300+'    && cap < 300)               return false;
      }
    }
    // Date availability
    if (dateStart) {
      const slots = v.slots;
      if (!slots || Object.keys(slots).length === 0) return false;
      const targetDays = daysOfWeekInRange(dateStart, dateEnd || dateStart);
      const hasOpen = [...targetDays].some(day => {
        const daySlots: { status: string }[] = slots[day] || [];
        return daySlots.some(s => s.status === 'open');
      });
      if (!hasOpen) return false;
    }
    return true;
  });

  // ── Active filter state ───────────────────────────────────────────
  const feeActive  = feeRanges.length > 0;
  const dateActive = !!dateStart;
  const capActive  = capacity !== 'any';
  const fmtDate    = (s: string) => s.split('-').reverse().join('/');

  const activeFilterCount =
    (feeActive ? 1 : 0) + (dateActive ? 1 : 0) + (capActive ? 1 : 0) + (genres.length > 0 ? 1 : 0);

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [
    ...feeRanges.map(k => ({
      key: `fee-${k}`,
      label: FEE_RANGES.find(r => r.key === k)?.label ?? k,
      onRemove: () => setFeeRanges(prev => prev.filter(x => x !== k)),
    })),
    ...(dateStart ? [{ key: 'date', label: dateEnd ? `${fmtDate(dateStart)}–${fmtDate(dateEnd)}` : fmtDate(dateStart), onRemove: () => { setDateStart(''); setDateEnd(''); } }] : []),
    ...(capacity !== 'any' ? [{ key: 'cap', label: CAPACITY_OPTIONS.find(o => o.value === capacity)?.label ?? capacity, onRemove: () => setCapacity('any') }] : []),
    ...genres.map(g => ({ key: `genre-${g}`, label: g, onRemove: () => setGenres(prev => prev.filter(x => x !== g)) })),
  ];

  // ── Shared sidebar (web) ──────────────────────────────────────────
  const WebSidebar = (
    <View style={[st.sidebar, { backgroundColor: colors.bg }]}>
      <View style={[st.sidebarHead, { borderBottomColor: colors.border }]}>
        <Text style={[st.sidebarTitle, { color: colors.black }]}>Filters</Text>
        <TouchableOpacity onPress={resetFilters}><Text style={st.resetAll}>Reset all</Text></TouchableOpacity>
      </View>

      {/* SEARCH */}
      <View style={[st.filterSection, { zIndex: 200, overflow: 'visible' as any }]}>
        <Text style={st.filterLabel}>SEARCH</Text>
        <View style={st.searchWrap}>
          <View style={st.searchRow}>
            <TextInput
              style={[st.filterInput, st.searchInput, search ? st.filterInputOn : null]}
              placeholder="Venue, suburb or postcode…" placeholderTextColor="#999"
              value={search} onChangeText={handleSearchChange}
              onFocus={() => hasDropdown && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {search ? <TouchableOpacity style={st.clearX} onPress={clearSearch}><Text style={st.clearXText}>✕</Text></TouchableOpacity> : null}
          </View>
          {showDropdown && hasDropdown && (
            <View style={st.dropdown}>
              {venueMatches.length > 0 && (<>
                <Text style={st.dropSection}>VENUES</Text>
                {venueMatches.map(v => (
                  <TouchableOpacity key={v.id} style={st.dropItem} onPress={() => selectVenueMatch(v)}>
                    <Text style={st.dropItemText}>🏛 {v.name}</Text>
                    {v.suburb ? <Text style={st.dropItemMeta}>{v.suburb}</Text> : null}
                  </TouchableOpacity>
                ))}
              </>)}
              {areaSuggestions.length > 0 && (<>
                <Text style={st.dropSection}>AREAS</Text>
                {areaSuggestions.map((s, i) => (
                  <TouchableOpacity key={i} style={st.dropItem} onPress={() => selectAreaSuggestion(s)}>
                    <Text style={st.dropItemText}>📍 {s.label}</Text>
                  </TouchableOpacity>
                ))}
              </>)}
            </View>
          )}
        </View>
        {locationCoords && (
          <View style={st.radiusPills}>
            {RADIUS_OPTIONS.map(km => (
              <TouchableOpacity key={km} style={[st.radiusPill, radius === km && st.radiusPillOn]} onPress={() => setRadius(km)}>
                <Text style={[st.radiusPillText, radius === km && st.radiusPillTextOn]}>{km}km</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* FEE RANGE */}
      <View style={st.filterSection}>
        <Text style={st.filterLabel}>FEE RANGE</Text>
        {FEE_RANGES.map(r => (
          <TouchableOpacity key={r.key} style={st.checkRow} onPress={() => toggleFee(r.key)}>
            <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
            <Text style={st.checkLabel}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* AVAILABILITY */}
      <View style={st.filterSection}>
        <Text style={st.filterLabel}>AVAILABILITY</Text>
        <Text style={st.filterSubLabel}>FROM</Text>
        <View style={{ marginBottom: 8 }}>
          <CalendarPicker value={dateStart} onChange={v => { setDateStart(v); if (dateEnd && v && v > dateEnd) setDateEnd(v); }} colors={colors} />
        </View>
        <Text style={st.filterSubLabel}>TO</Text>
        <CalendarPicker value={dateEnd} onChange={setDateEnd} minDate={dateStart || undefined} colors={colors} />
      </View>

      {/* CAPACITY */}
      <View style={st.filterSection}>
        <Text style={st.filterLabel}>CAPACITY</Text>
        {isWeb ? (
          // @ts-ignore — web-only <select> element
          <select
            value={capacity}
            onChange={(e: any) => setCapacity(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px',
              border: '1px solid #e0e0e0', borderRadius: 8,
              fontSize: 13, color: '#111111',
              backgroundColor: '#fafafa', cursor: 'pointer',
              outline: 'none', appearance: 'auto',
            } as any}
          >
            {CAPACITY_OPTIONS.map(o => (
              // @ts-ignore
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <View style={st.genreGrid}>
            {CAPACITY_OPTIONS.map(o => (
              <TouchableOpacity key={o.value} style={[st.genrePill, capacity === o.value && st.genrePillOn]} onPress={() => setCapacity(o.value)}>
                <Text style={[st.genrePillText, capacity === o.value && st.genrePillTextOn]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* GENRE */}
      <View style={st.filterSection}>
        <Text style={st.filterLabel}>GENRE</Text>
        <View style={st.genreGrid}>
          <TouchableOpacity style={[st.genrePill, genres.length === 0 && st.genrePillOn]} onPress={() => setGenres([])}>
            <Text style={[st.genrePillText, genres.length === 0 && st.genrePillTextOn]}>All</Text>
          </TouchableOpacity>
          {GENRES.map(g => (
            <TouchableOpacity key={g} style={[st.genrePill, genres.includes(g) && st.genrePillOn]} onPress={() => toggleGenre(g)}>
              <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  // ── Native filter bar (top of content) ───────────────────────────
  const NativeFilterBar = (
    <View style={st.nativeFilterWrap}>
      {/* Search + Filters button */}
      <View style={st.nativeTopRow}>
        <View style={st.nativeSearchBox}>
          <TextInput
            style={st.nativeSearchInput}
            placeholder="Venue, suburb or postcode…" placeholderTextColor="#999"
            value={search} onChangeText={handleSearchChange}
            onFocus={() => hasDropdown && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {search ? <TouchableOpacity style={st.nativeClearX} onPress={clearSearch}><Text style={st.clearXText}>✕</Text></TouchableOpacity> : null}
        </View>
        <TouchableOpacity
          style={[st.filtersBtn, activeFilterCount > 0 && st.filtersBtnOn]}
          onPress={openFilterPanel}
          activeOpacity={0.8}
        >
          <Text style={[st.filtersBtnText, activeFilterCount > 0 && st.filtersBtnTextOn]}>
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search dropdown */}
      {showDropdown && hasDropdown && (
        <View style={[st.dropdown, { top: 54, left: 16, right: 16, zIndex: 9999 }]}>
          {venueMatches.length > 0 && (<>
            <Text style={st.dropSection}>VENUES</Text>
            {venueMatches.map(v => (
              <TouchableOpacity key={v.id} style={st.dropItem} onPress={() => selectVenueMatch(v)}>
                <Text style={st.dropItemText}>🏛 {v.name}</Text>
                {v.suburb ? <Text style={st.dropItemMeta}>{v.suburb}</Text> : null}
              </TouchableOpacity>
            ))}
          </>)}
          {areaSuggestions.length > 0 && (<>
            <Text style={st.dropSection}>AREAS</Text>
            {areaSuggestions.map((s, i) => (
              <TouchableOpacity key={i} style={st.dropItem} onPress={() => selectAreaSuggestion(s)}>
                <Text style={st.dropItemText}>📍 {s.label}</Text>
              </TouchableOpacity>
            ))}
          </>)}
        </View>
      )}

      {/* Radius pills (location selected) */}
      {locationCoords && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
          {RADIUS_OPTIONS.map(km => (
            <TouchableOpacity key={km} style={[st.radiusPill, radius === km && st.radiusPillOn]} onPress={() => setRadius(km)}>
              <Text style={[st.radiusPillText, radius === km && st.radiusPillTextOn]}>{km}km</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
          {activeChips.map(chip => (
            <TouchableOpacity key={chip.key} style={st.activeChip} onPress={chip.onRemove}>
              <Text style={st.activeChipText}>{chip.label}  ✕</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={st.resetPill} onPress={resetFilters}>
            <Text style={st.resetPillText}>Reset All</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );

  // ── Filter panel (slide in from left) ────────────────────────────
  const FilterPanel = (
    <Modal visible={showFilterPanel} transparent animationType="none" onRequestClose={closeFilterPanel}>
      <View style={st.fpOverlay}>
        <Animated.View style={[st.fpPanel, { transform: [{ translateX: slideAnim }] }]}>
          {/* Header */}
          <View style={st.fpHeader}>
            <Text style={st.fpTitle}>Filters</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <TouchableOpacity onPress={() => { resetFilters(); }} activeOpacity={0.7}>
                <Text style={st.fpReset}>Reset All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.fpDoneBtn} onPress={closeFilterPanel} activeOpacity={0.8}>
                <Text style={st.fpDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
            {/* FEE RANGE */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>FEE RANGE</Text>
              {FEE_RANGES.map(r => (
                <TouchableOpacity key={r.key} style={st.fpOptionRow} onPress={() => toggleFee(r.key)}>
                  <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
                  <Text style={st.fpOptionText}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* AVAILABILITY */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>AVAILABILITY</Text>
              <Text style={st.fpSubLabel}>FROM</Text>
              <View style={{ marginBottom: 10 }}>
                <CalendarPicker
                  value={dateStart}
                  onChange={v => { setDateStart(v); if (dateEnd && v && v > dateEnd) setDateEnd(v); }}
                  colors={colors}
                />
              </View>
              <Text style={st.fpSubLabel}>TO</Text>
              <CalendarPicker value={dateEnd} onChange={setDateEnd} minDate={dateStart || undefined} colors={colors} />
            </View>

            {/* CAPACITY */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>CAPACITY</Text>
              <View style={st.genreGrid}>
                {CAPACITY_OPTIONS.map(o => (
                  <TouchableOpacity key={o.value} style={[st.genrePill, capacity === o.value && st.genrePillOn]} onPress={() => setCapacity(o.value)}>
                    <Text style={[st.genrePillText, capacity === o.value && st.genrePillTextOn]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* GENRE */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>GENRE</Text>
              <View style={st.genreGrid}>
                <TouchableOpacity style={[st.genrePill, genres.length === 0 && st.genrePillOn]} onPress={() => setGenres([])}>
                  <Text style={[st.genrePillText, genres.length === 0 && st.genrePillTextOn]}>All</Text>
                </TouchableOpacity>
                {GENRES.map(g => (
                  <TouchableOpacity key={g} style={[st.genrePill, genres.includes(g) && st.genrePillOn]} onPress={() => toggleGenre(g)}>
                    <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </Animated.View>

        {/* Backdrop — tap to close */}
        <TouchableOpacity style={st.fpBackdrop} activeOpacity={1} onPress={closeFilterPanel} />
      </View>
    </Modal>
  );

  // ── Venue card ────────────────────────────────────────────────────
  function VenueCard({ item }: { item: Venue }) {
    const c = colors;
    const photo      = item.photoUrl || (item.photos?.[0]);
    const venueGenres: string[] = (item as any).genres || item.genre || [];
    const address    = [item.streetAddress, item.suburb, item.state, (item as any).postcode].filter(Boolean).join(', ');
    const openSlots  = countOpenSlotsForRange(item, dateStart, dateEnd);

    return (
      <TouchableOpacity
        activeOpacity={0.97}
        style={[st.card, { backgroundColor: c.bg, borderColor: c.border }]}
        onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
      >
        {photo
          ? <CardPhoto uri={photo} position={item.photoPosition} />
          : <View style={[st.cardPhotoEmpty, { backgroundColor: c.bgFaint }]}><Text style={[st.cardPhotoLabel, { color: c.grey }]}>venue photo</Text></View>
        }
        <View style={st.cardBody}>
          <Text style={[st.venueName, { color: c.black }]}>{item.name}</Text>
          {address ? <Text style={[st.venueAddr, { color: c.grey }]}>{address}</Text> : null}
          {venueGenres.length > 0 && (
            <View style={st.genreRow}>
              {venueGenres.slice(0, 6).map((g: string) => (
                <View key={g} style={st.pill}><Text style={st.pillText}>{g}</Text></View>
              ))}
            </View>
          )}
          {item.description ? <Text style={[st.desc, { color: c.black }]} numberOfLines={2}>{item.description}</Text> : null}
          <View style={[st.cardFooter, { borderTopColor: c.borderFaint }]}>
            {openSlots === 0
              ? <Text style={[st.slotsNone, { color: c.greyLight }]}>No slots listed yet</Text>
              : <Text style={[st.slotsText, { color: c.grey }]}><Text style={st.slotsCount}>{openSlots}</Text>{` open slot${openSlots !== 1 ? 's' : ''}`}</Text>
            }
            <View style={st.cardActions}>
              <TouchableOpacity style={st.profileBtn} onPress={() => router.push(`/venue/${item.id}`)}>
                <Text style={st.profileBtnText}>Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.actionBtn} onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}>
                <Text style={st.actionBtnText}>Timetable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Web layout ────────────────────────────────────────────────────
  if (isWeb) {
    return (
      <View style={[st.page, { backgroundColor: colors.bg }]}>
        <ScrollView style={st.sidebarScroll} showsVerticalScrollIndicator={false}>{WebSidebar}</ScrollView>
        <ScrollView
          style={st.contentScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        >
          <View style={st.content}>
            <Text style={[st.pageTitle, { color: colors.black }]}>Find your next gig</Text>
            <Text style={[st.countText, { color: colors.grey }]}>{filtered.length} venue{filtered.length !== 1 ? 's' : ''} match your filters</Text>
            {loading
              ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
              : filtered.length === 0
                ? <Text style={st.empty}>No venues match your filters.</Text>
                : <View style={st.grid}>{filtered.map(item => <View key={item.id} style={{ width: '49%' }}><VenueCard item={item} /></View>)}</View>
            }
          </View>
          <View style={{ height: 60 }} />
        </ScrollView>
      </View>
    );
  }

  // ── Native layout ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={[st.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[0]}
      >
        {/* Sticky filter bar */}
        <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>{NativeFilterBar}</View>

        {/* Cards */}
        <View style={st.nativeContent}>
          <View style={st.countRow}>
            <Text style={st.countText}>{filtered.length} venue{filtered.length !== 1 ? 's' : ''}</Text>
          </View>
          {loading
            ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
            : filtered.length === 0
              ? <Text style={st.empty}>No venues match your filters.</Text>
              : filtered.map(item => <VenueCard key={item.id} item={item} />)
          }
          <View style={{ height: 48 }} />
        </View>
      </ScrollView>
      {FilterPanel}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  // Web two-column
  page:          { flex: 1, flexDirection: 'row', backgroundColor: '#ffffff' },
  sidebarScroll: { width: 280, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: '#eeeeee' },
  contentScroll: { flex: 1 },

  sidebar:    { padding: 24, paddingTop: 28, paddingBottom: 48 },
  sidebarHead:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  sidebarTitle:{ fontSize: 18, fontWeight: '700', color: '#111111' },
  resetAll:   { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  filterSection:{ marginBottom: 24 },
  filterLabel:{ fontSize: 10, fontWeight: '700', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  filterSubLabel:{ fontSize: 10, fontWeight: '700', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  filterInput:{ borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 9, paddingHorizontal: 12, fontSize: 13, color: '#111111', backgroundColor: '#fafafa' },
  filterInputOn:{ borderColor: Colors.orange, backgroundColor: '#ffffff' },

  searchWrap: { position: 'relative' as any, zIndex: 200, overflow: 'visible' as any },
  searchRow:  { flexDirection: 'row', alignItems: 'center' },
  searchInput:{ flex: 1 },
  clearX:     { position: 'absolute' as any, right: 10, padding: 2 },
  clearXText: { fontSize: 13, color: '#111111' },

  dropdown: {
    position: 'absolute' as any, top: 42, left: 0, right: 0,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e0e0',
    borderRadius: 8, zIndex: 9999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 10,
  },
  dropSection:  { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: '#999999' },
  dropItem:     { paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropItemText: { fontSize: 13, color: '#222222' },
  dropItemMeta: { fontSize: 11, color: '#888888' },

  radiusPills:    { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  radiusPill:     { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  radiusPillOn:   { backgroundColor: Colors.orange, borderColor: Colors.orange },
  radiusPillText: { fontSize: 12, color: '#111111' },
  radiusPillTextOn:{ color: '#ffffff', fontWeight: '600' },

  checkRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  checkbox:   { width: 15, height: 15, borderRadius: 3, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkLabel: { fontSize: 13, color: '#111111' },

  genreGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:      { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  genrePillOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  genrePillText:  { fontSize: 12, color: '#111111' },
  genrePillTextOn:{ color: '#ffffff', fontWeight: '600' },

  // Content
  content:   { padding: 36, paddingTop: 32, paddingBottom: 48 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginBottom: 4 },
  countText: { fontSize: 13, color: '#666666', marginBottom: 16 },
  empty:     { color: '#111111', fontSize: 14, marginTop: 40 },

  // Native filter bar
  nativeFilterBg:   { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  nativeFilterWrap: { paddingTop: 12, paddingBottom: 8 },
  nativeTopRow:     { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  nativeSearchBox:  { flex: 1, flexDirection: 'row', alignItems: 'center' },
  nativeSearchInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 10, paddingHorizontal: 14, fontSize: 14, color: '#111111', backgroundColor: '#fafafa',
  },
  nativeClearX: { paddingLeft: 8 },
  nativePillScroll: { flexGrow: 0 },
  nativePillRow:    { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingBottom: 6 },

  filtersBtn:      { borderRadius: 10, borderWidth: 1.5, borderColor: '#dddddd', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fafafa' },
  filtersBtnOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filtersBtnText:  { fontSize: 14, fontWeight: '600', color: '#555555' },
  filtersBtnTextOn:{ color: '#ffffff' },

  activeChip:     { borderRadius: 20, borderWidth: 1, borderColor: Colors.orange, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.orange + '18' },
  activeChipText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  resetPill:      { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7 },
  resetPillText:  { fontSize: 13, fontWeight: '600', color: Colors.orange },

  // Filter panel (slide-in from left)
  fpOverlay:    { flex: 1, flexDirection: 'row' },
  fpPanel: {
    width: PANEL_W, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 6, height: 0 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16,
  },
  fpBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  fpHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 52, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  fpTitle:      { fontSize: 18, fontWeight: '700', color: '#111111' },
  fpReset:      { fontSize: 13, fontWeight: '600', color: Colors.orange },
  fpDoneBtn:    { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  fpDoneBtnText:{ fontSize: 13, fontWeight: '700', color: '#ffffff' },
  fpSection:    { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 4 },
  fpSectionTitle:{ fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  fpSubLabel:   { fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 12 },
  fpOptionRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  fpOptionText: { fontSize: 14, color: '#111111' },

  nativeContent:  { paddingHorizontal: 16 },
  countRow:       { paddingTop: 14, paddingBottom: 8 },

  // Cards
  card: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  cardPhoto:      { width: '100%', height: 160 },
  cardPhotoEmpty: { width: '100%', height: 160, backgroundColor: '#e8e3d8', alignItems: 'center', justifyContent: 'center' },
  cardPhotoLabel: { fontSize: 12, color: '#111111', fontStyle: 'italic' },
  cardBody:       { padding: 18, paddingHorizontal: 20, gap: 8 },
  venueName:      { fontSize: 18, fontWeight: '700', color: '#111111' },
  venueAddr:      { fontSize: 12, color: '#666666' },
  genreRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill:           { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  pillText:       { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  desc:           { fontSize: 13, color: '#111111', lineHeight: 19 },
  cardFooter:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  slotsText:      { fontSize: 13, color: '#444444' },
  slotsCount:     { fontSize: 13, color: Colors.orange, fontWeight: '700' },
  slotsNone:      { fontSize: 13, color: '#aaaaaa', fontStyle: 'italic' },
  cardActions:    { flexDirection: 'row', gap: 8 },
  profileBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  profileBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  actionBtn:      { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  actionBtnText:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});
