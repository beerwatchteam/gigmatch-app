import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
  ScrollView, Platform, Animated, Modal, Dimensions, useWindowDimensions,
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
  slots?: Record<string, any[]>;
  settings?: { listed?: boolean };
};

type SlotDetail = {
  dateLabel: string;
  time: string;
  slotType?: string;
  duration?: number;
  day: string;
  dateStr: string | null;
  room?: string;
  sortMs: number;
};

function getNextOpenSlotsDetailed(venue: Venue): SlotDetail[] {
  const slots = venue.slots;
  if (!slots) return [];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming: SlotDetail[] = [];
  for (const [day, daySlots] of Object.entries(slots)) {
    const open = (daySlots as any[]).filter(s => s.status === 'open');
    for (const slot of open) {
      let d: Date;
      let dateStr: string | null = null;
      if (slot.date) {
        const [y, m, dd] = slot.date.split('-').map(Number);
        d = new Date(y, m - 1, dd);
        if (d < today) continue;
        dateStr = slot.date;
      } else {
        const dow = DAY_NAMES.indexOf(day);
        if (dow === -1) continue;
        d = new Date(today);
        const diff = (dow - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
      }
      const dl = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
      upcoming.push({ dateLabel: dl, time: slot.time || '', slotType: slot.slotType, duration: slot.duration, day, dateStr, room: slot.room || undefined, sortMs: d.getTime() });
    }
  }
  upcoming.sort((a, b) => a.sortMs - b.sortMs);
  return upcoming;
}

function getNextOpenSlots(venue: Venue, count: number): string[] {
  const slots = venue.slots;
  if (!slots) return [];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming: { ms: number; label: string }[] = [];
  for (const [day, daySlots] of Object.entries(slots)) {
    const open = (daySlots as any[]).filter(s => s.status === 'open');
    for (const slot of open) {
      let d: Date;
      if (slot.date) {
        const [y, m, dd] = slot.date.split('-').map(Number);
        d = new Date(y, m - 1, dd);
        if (d < today) continue;
      } else {
        const dow = DAY_NAMES.indexOf(day);
        if (dow === -1) continue;
        d = new Date(today);
        const diff = (dow - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
      }
      const dl = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
      upcoming.push({ ms: d.getTime(), label: `${dl} · ${slot.time || ''}` });
    }
  }
  upcoming.sort((a, b) => a.ms - b.ms);
  return upcoming.slice(0, count).map(u => u.label);
}

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
  const { width: windowWidth } = useWindowDimensions();
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
  const [webDropdown, setWebDropdown]         = useState<'date' | 'capacity' | 'genre' | 'fee' | null>(null);
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

  // ── Web ledger row ────────────────────────────────────────────────
  function WebVenueRow({ item }: { item: Venue }) {
    const photo = item.photoUrl || (item.photos?.[0]);
    const venueGenres: string[] = (item as any).genres || item.genre || [];
    const d0 = toLocalStr(new Date());
    const d42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
    const nextSlots = getNextOpenSlots(item, 2);
    const hasSlots = nextSlots.length > 0;
    const totalSlots = countOpenSlotsForRange(item, d0, d42);
    const extraCount = Math.max(0, totalSlots - 2);
    const feeStr = item.feeMin != null && item.feeMax != null
      ? `$${item.feeMin.toLocaleString()}–$${item.feeMax.toLocaleString()}`
      : item.feeMin != null ? `from $${item.feeMin.toLocaleString()}`
      : '—';

    return (
      <TouchableOpacity
        style={st.webRow}
        onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
        activeOpacity={0.8}
      >
        <View style={[st.webRowCell, { flex: 3 }]}>
          <View style={st.webRowVenue}>
            {photo
              ? <Image source={{ uri: photo }} style={st.webRowThumb} resizeMode="cover" />
              : <View style={[st.webRowThumb, st.webRowThumbEmpty]}><Text style={st.webRowThumbLabel}>photo</Text></View>
            }
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.webRowName} numberOfLines={1}>{item.name}</Text>
              <Text style={st.webRowMeta} numberOfLines={1}>
                {[item.suburb, venueGenres.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
        </View>

        <View style={[st.webRowCell, { width: 80 }]}>
          <Text style={st.webRowCap}>{item.capacity ?? '—'}</Text>
        </View>

        <View style={[st.webRowCell, { flex: 4 }]}>
          {hasSlots ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' as any, gap: 6 }}>
              {nextSlots.map((label, i) => (
                <View key={i} style={st.webSlotChip}>
                  <Text style={st.webSlotChipText}>{label}</Text>
                </View>
              ))}
              {extraCount > 0 && <Text style={st.webSlotExtra}>+{extraCount} more</Text>}
            </View>
          ) : (
            <Text style={st.webSlotNone}>No open slots</Text>
          )}
        </View>

        <View style={[st.webRowCell, { width: 120 }]}>
          <Text style={st.webRowFee}>{feeStr}</Text>
        </View>

        <View style={[st.webRowCell, { width: 100, alignItems: 'flex-end' }]}>
          {hasSlots ? (
            <TouchableOpacity
              style={st.webEnquireBtn}
              onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
            >
              <Text style={st.webEnquireBtnText}>Enquire</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={st.webWatchBtn}
              onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
            >
              <Text style={st.webWatchBtnText}>Watch</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  }


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
          style={[st.filterIconBtn, activeFilterCount > 0 && st.filterIconBtnOn]}
          onPress={openFilterPanel}
          activeOpacity={0.8}
        >
          <View style={{ gap: 3.5 }}>
            <View style={{ height: 1.5, backgroundColor: activeFilterCount > 0 ? '#ffffff' : '#555555', borderRadius: 1, width: 18 }} />
            <View style={{ height: 1.5, backgroundColor: activeFilterCount > 0 ? '#ffffff' : '#555555', borderRadius: 1, width: 13, marginLeft: 2.5 }} />
            <View style={{ height: 1.5, backgroundColor: activeFilterCount > 0 ? '#ffffff' : '#555555', borderRadius: 1, width: 8, marginLeft: 5 }} />
          </View>
          {activeFilterCount > 0 && (
            <View style={st.filterIconBadge}>
              <Text style={st.filterIconBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
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

  // ── Venue card (native) ───────────────────────────────────────────
  function VenueCard({ item }: { item: Venue }) {
    const photo = item.photoUrl || (item.photos?.[0]);
    const d0  = toLocalStr(new Date());
    const d42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
    const allSlots   = getNextOpenSlotsDetailed(item);
    const shown      = allSlots.slice(0, 2);
    const totalSlots = countOpenSlotsForRange(item, d0, d42);
    const extraCount = Math.max(0, totalSlots - 2);
    const feeStr = item.feeMin != null && item.feeMax != null
      ? `$${item.feeMin.toLocaleString()}–$${item.feeMax.toLocaleString()}`
      : item.feeMin != null ? `$${item.feeMin.toLocaleString()}+` : null;
    const metaParts = [item.suburb, item.capacity ? `cap. ${item.capacity}` : null, feeStr].filter(Boolean);

    return (
      <TouchableOpacity
        activeOpacity={0.97}
        style={[st.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
        onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'overview' } })}
      >
        {/* Photo */}
        {photo
          ? <CardPhoto uri={photo} position={item.photoPosition} />
          : <View style={[st.cardPhotoEmpty, { backgroundColor: colors.bgFaint }]}><Text style={[st.cardPhotoLabel, { color: colors.greyLight }]}>venue photo</Text></View>
        }

        {/* Body */}
        <View style={st.cardBody}>
          <Text style={[st.venueName, { color: colors.black }]}>{item.name}</Text>
          {metaParts.length > 0 && (
            <Text style={[st.venueAddr, { color: colors.grey }]} numberOfLines={1}>{metaParts.join(' · ')}</Text>
          )}

          {/* Slot rows */}
          {shown.length === 0 ? (
            <Text style={[st.slotsNone, { color: colors.greyLight }]}>No open slots</Text>
          ) : (
            <View style={st.slotList}>
              {shown.map((slot, i) => (
                <TouchableOpacity
                  key={i}
                  style={[st.slotRow, { backgroundColor: Colors.orange + '18' }]}
                  onPress={() => router.push({
                    pathname: '/enquire',
                    params: {
                      venueId:   item.id,
                      venueName: item.name,
                      day:       slot.day,
                      ...(slot.dateStr ? { date: slot.dateStr } : {}),
                      time:      slot.time,
                      ...(slot.room ? { room: slot.room } : {}),
                      slotType:  slot.slotType ?? 'Open',
                    },
                  })}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={st.slotDate}>{slot.dateLabel} · {slot.time}</Text>
                    {(slot.slotType || slot.duration) ? (
                      <Text style={[st.slotMeta, { color: Colors.orange }]}>
                        {[slot.slotType, slot.duration ? `${slot.duration}min` : null].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={st.slotEnquireBtn}>
                    <Text style={st.slotEnquireBtnText}>Enquire</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* More slots */}
          {extraCount > 0 && (
            <TouchableOpacity
              style={[st.moreBtn, { borderColor: colors.border }]}
              onPress={() => router.push({ pathname: '/venue/[id]', params: { id: item.id, tab: 'timetable' } })}
            >
              <Text style={[st.moreBtnText, { color: colors.grey }]}>+{extraCount} more slots</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // ── Web layout ────────────────────────────────────────────────────
  if (isWeb) {
    const d0 = toLocalStr(new Date());
    const d42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
    const totalOpenSlots = venues.reduce((sum, v) => sum + countOpenSlotsForRange(v, d0, d42), 0);
    const heroLocation = locationCoords && search ? search : null;
    const capacityLabel = capacity === 'any' ? 'any' : (CAPACITY_OPTIONS.find(o => o.value === capacity)?.label ?? capacity);
    const dateLabel = dateStart
      ? (dateEnd ? `${formatDateDisplay(dateStart)}–${formatDateDisplay(dateEnd)}` : formatDateDisplay(dateStart))
      : 'any date';

    // ── Mobile web (< 768 px) ──────────────────────────────────────
    if (windowWidth < 768) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
            stickyHeaderIndices={[1]}
          >
            {/* Hero */}
            <View style={[st.mobileWebHero, { backgroundColor: '#f2ede6' }]}>
              <Text style={st.webHeroLabel}>
                OPEN SLOTS{heroLocation ? ` · ${heroLocation.toUpperCase()}` : ''}
              </Text>
              <Text style={st.mobileWebHeroTitle}>Find your next gig</Text>
              <Text style={st.webHeroSub}>
                {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalOpenSlots} open slots in the next 6 weeks
              </Text>
            </View>

            {/* Sticky filter bar */}
            <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
              {NativeFilterBar}
            </View>

            {/* Cards */}
            <View style={st.nativeContent}>
              {loading
                ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
                : filtered.length === 0
                  ? <Text style={[st.empty, { paddingTop: 24 }]}>No venues match your filters.</Text>
                  : filtered.map(item => <VenueCard key={item.id} item={item} />)
              }
              <View style={{ height: 48 }} />
            </View>
          </ScrollView>
          {FilterPanel}
        </View>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: '#f2ede6' }}>
        {/* Dropdown backdrop */}
        {webDropdown !== null && (
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 } as any}
            activeOpacity={1}
            onPress={() => setWebDropdown(null)}
          />
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        >
          {/* ── Hero ──────────────────────────────────────────────── */}
          <View style={st.webHero}>
            <View style={st.webHeroInner}>
              <View style={{ flex: 1 }}>
                <Text style={st.webHeroLabel}>
                  OPEN SLOTS{heroLocation ? ` · ${heroLocation.toUpperCase()}` : ''}
                </Text>
                <Text style={st.webHeroTitle}>Find your next gig</Text>
                <Text style={st.webHeroSub}>
                  {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalOpenSlots} open slots in the next 6 weeks
                </Text>
              </View>

              {/* Search */}
              <View style={{ width: 340, zIndex: 200 } as any}>
                <View style={{ position: 'relative' as any, zIndex: 200 }}>
                  <View style={st.webSearchRow}>
                    <TextInput
                      style={st.webSearchInput}
                      placeholder="Venue, suburb or postcode"
                      placeholderTextColor="#999"
                      value={search}
                      onChangeText={handleSearchChange}
                      onFocus={() => hasDropdown && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    />
                    <TouchableOpacity style={st.webSearchBtn} onPress={() => setShowDropdown(false)}>
                      <Text style={st.webSearchBtnText}>Search</Text>
                    </TouchableOpacity>
                  </View>
                  {showDropdown && hasDropdown && (
                    <View style={[st.dropdown, { top: 48, left: 0, right: 0, zIndex: 9999 }]}>
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
                  <View style={[st.radiusPills, { marginTop: 10 }]}>
                    {RADIUS_OPTIONS.map(km => (
                      <TouchableOpacity key={km} style={[st.radiusPill, radius === km && st.radiusPillOn]} onPress={() => setRadius(km)}>
                        <Text style={[st.radiusPillText, radius === km && st.radiusPillTextOn]}>{km}km</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ── Filter chip bar ───────────────────────────────────── */}
          <View style={[st.webFilterBar, { zIndex: 100 }]}>
            <View style={st.webFilterInner}>
              {/* Available dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, dateActive && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'date' ? null : 'date')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, dateActive && st.webFilterPillTextActive]}>
                    Available {dateLabel} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'date' && (
                  <View style={[st.webFilterDropdown, { width: 260 }]}>
                    <Text style={st.webFilterDropLabel}>FROM</Text>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e: any) => { setDateStart(e.target.value); if (dateEnd && e.target.value > dateEnd) setDateEnd(''); }}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 13, marginBottom: 10, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' } as any}
                    />
                    <Text style={st.webFilterDropLabel}>TO</Text>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      value={dateEnd}
                      min={dateStart || undefined}
                      onChange={(e: any) => setDateEnd(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 13, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' } as any}
                    />
                    {dateStart && (
                      <TouchableOpacity style={{ marginTop: 12 }} onPress={() => { setDateStart(''); setDateEnd(''); setWebDropdown(null); }}>
                        <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear dates</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Capacity dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, capActive && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'capacity' ? null : 'capacity')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, capActive && st.webFilterPillTextActive]}>
                    Capacity {capacityLabel} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'capacity' && (
                  <View style={st.webFilterDropdown}>
                    {CAPACITY_OPTIONS.map(o => (
                      <TouchableOpacity
                        key={o.value}
                        style={[st.webDropdownOption, capacity === o.value && st.webDropdownOptionActive]}
                        onPress={() => { setCapacity(o.value); setWebDropdown(null); }}
                      >
                        <Text style={[st.webDropdownOptionText, capacity === o.value && st.webDropdownOptionTextActive]}>
                          {o.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Genre dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, genres.length > 0 && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'genre' ? null : 'genre')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, genres.length > 0 && st.webFilterPillTextActive]}>
                    {genres.length === 0 ? 'Genre' : genres.length === 1 ? genres[0] : `Genre: ${genres.length}`} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'genre' && (
                  <View style={[st.webFilterDropdown, { width: 260 }]}>
                    <View style={st.genreGrid}>
                      {GENRES.map(g => (
                        <TouchableOpacity
                          key={g}
                          style={[st.genrePill, genres.includes(g) && st.genrePillOn]}
                          onPress={() => toggleGenre(g)}
                        >
                          <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {genres.length > 0 && (
                      <TouchableOpacity style={{ marginTop: 12 }} onPress={() => setGenres([])}>
                        <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear genres</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Fee dropdown */}
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <TouchableOpacity
                  style={[st.webFilterPill, feeActive && st.webFilterPillActive]}
                  onPress={() => setWebDropdown(d => d === 'fee' ? null : 'fee')}
                  activeOpacity={0.8}
                >
                  <Text style={[st.webFilterPillText, feeActive && st.webFilterPillTextActive]}>
                    {feeRanges.length === 0 ? 'Fee' : feeRanges.length === 1 ? (FEE_RANGES.find(r => r.key === feeRanges[0])?.label ?? 'Fee') : `Fee: ${feeRanges.length}`} ▾
                  </Text>
                </TouchableOpacity>
                {webDropdown === 'fee' && (
                  <View style={st.webFilterDropdown}>
                    {FEE_RANGES.map(r => (
                      <TouchableOpacity
                        key={r.key}
                        style={[st.webDropdownOption, feeRanges.includes(r.key) && st.webDropdownOptionActive]}
                        onPress={() => toggleFee(r.key)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
                          <Text style={[st.webDropdownOptionText, feeRanges.includes(r.key) && st.webDropdownOptionTextActive]}>
                            {r.label}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {feeRanges.length > 0 && (
                      <TouchableOpacity style={{ marginTop: 8, paddingHorizontal: 10 }} onPress={() => setFeeRanges([])}>
                        <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={resetFilters}>
                  <Text style={st.webClearText}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Ledger table ──────────────────────────────────────── */}
          <View style={{ backgroundColor: '#ffffff' }}>
            <View style={st.webTableHeader}>
              <Text style={[st.webTableHeaderCell, { flex: 3 }]}>VENUE</Text>
              <Text style={[st.webTableHeaderCell, { width: 80 }]}>CAPACITY</Text>
              <Text style={[st.webTableHeaderCell, { flex: 4 }]}>NEXT OPEN SLOTS</Text>
              <Text style={[st.webTableHeaderCell, { width: 120 }]}>TYPICAL FEE</Text>
              <Text style={[st.webTableHeaderCell, { width: 100, textAlign: 'right' }]}>ACTION</Text>
            </View>

            {loading
              ? <ActivityIndicator style={{ marginTop: 60, marginBottom: 60 }} color={Colors.orange} />
              : filtered.length === 0
                ? <Text style={[st.empty, { paddingHorizontal: 60, paddingTop: 40 }]}>No venues match your filters.</Text>
                : filtered.map(item => <WebVenueRow key={item.id} item={item} />)
            }
            <View style={{ height: 80 }} />
          </View>
        </ScrollView>
        {FilterPanel}
      </View>
    );
  }

  // ── Native layout ─────────────────────────────────────────────────
  const nD0  = toLocalStr(new Date());
  const nD42 = (() => { const d = new Date(); d.setDate(d.getDate() + 42); return toLocalStr(d); })();
  const totalNativeSlots = filtered.reduce((sum, v) => sum + countOpenSlotsForRange(v, nD0, nD42), 0);

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
          {/* Header */}
          <View style={st.nativeHeader}>
            <Text style={[st.nativeTitle, { color: colors.black }]}>Find your next gig</Text>
            <Text style={[st.nativeSub, { color: colors.grey }]}>
              {filtered.length} venue{filtered.length !== 1 ? 's' : ''} · {totalNativeSlots} open slot{totalNativeSlots !== 1 ? 's' : ''}
            </Text>
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

  // Native header
  nativeHeader:   { paddingTop: 20, paddingBottom: 12 },
  nativeTitle:    { fontSize: 26, fontWeight: '800', color: '#111111', letterSpacing: -0.5 },
  nativeSub:      { fontSize: 13, color: '#666666', marginTop: 3 },

  // Filter icon button
  filterIconBtn:      { borderRadius: 10, borderWidth: 1.5, borderColor: '#dddddd', padding: 10, backgroundColor: '#fafafa', position: 'relative' as any },
  filterIconBtnOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterIconBadge:    { position: 'absolute' as any, top: -5, right: -5, backgroundColor: '#111111', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  filterIconBadgeText:{ color: '#ffffff', fontSize: 9, fontWeight: '800', lineHeight: 16 },

  // Slot rows (inside VenueCard)
  slotList:         { gap: 8, marginTop: 4 },
  slotRow:          { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  slotDate:         { fontSize: 13, fontWeight: '700', color: '#111111' },
  slotMeta:         { fontSize: 11, fontWeight: '600', marginTop: 1 },
  slotEnquireBtn:   { borderRadius: 8, backgroundColor: '#111111', paddingHorizontal: 14, paddingVertical: 7 },
  slotEnquireBtnText:{ fontSize: 12, fontWeight: '700', color: '#ffffff' },
  moreBtn:          { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', marginTop: 4 },
  moreBtnText:      { fontSize: 13, fontWeight: '600' },

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

  // ── Mobile web hero ───────────────────────────────────────────────
  mobileWebHero:      { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 },
  mobileWebHeroTitle: { fontSize: 30, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginTop: 6, lineHeight: 36 },

  // ── Web hero ─────────────────────────────────────────────────────
  webHero:        { backgroundColor: '#f2ede6', paddingHorizontal: 32, paddingTop: 48, paddingBottom: 40 },
  webHeroInner:   { flexDirection: 'row', alignItems: 'flex-end', gap: 40 },
  webHeroLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: Colors.orange, textTransform: 'uppercase' as any },
  webHeroTitle:   { fontSize: 48, fontWeight: '800', color: '#111111', letterSpacing: -1.5 as any, marginTop: 6, lineHeight: 52 },
  webHeroSub:     { fontSize: 14, color: '#666666', marginTop: 8 },
  webSearchRow:   { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  webSearchInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#d8d3cd', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#111111',
    backgroundColor: '#ffffff',
  },
  webSearchBtn:     { backgroundColor: '#111111', borderRadius: 8, paddingHorizontal: 22, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  webSearchBtnText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Web filter bar ────────────────────────────────────────────────
  webFilterBar:   { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e0dbd4', borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  webFilterInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 12, gap: 8, flexWrap: 'wrap' as any },
  webFilterPill:  { borderWidth: 1, borderColor: '#d0ccc7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#ffffff' },
  webFilterPillActive:     { borderColor: Colors.orange, backgroundColor: Colors.orange + '12' },
  webFilterPillText:       { fontSize: 13, color: '#333333', fontWeight: '500' },
  webFilterPillTextActive: { color: Colors.orange, fontWeight: '600' },
  webFilterDropdown: {
    position: 'absolute' as any, top: '110%' as any, left: 0, marginTop: 4,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e0e0',
    borderRadius: 10, padding: 14, zIndex: 300, minWidth: 180,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 12,
  },
  webFilterDropLabel:       { fontSize: 10, fontWeight: '700', color: '#888888', letterSpacing: 0.8, textTransform: 'uppercase' as any, marginBottom: 6 },
  webDropdownOption:        { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 6 },
  webDropdownOptionActive:  { backgroundColor: Colors.orange + '18' },
  webDropdownOptionText:    { fontSize: 13, color: '#333333' },
  webDropdownOptionTextActive: { color: Colors.orange, fontWeight: '600' },
  webActiveChip:     { borderWidth: 1, borderColor: Colors.orange, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.orange + '12' },
  webActiveChipText: { fontSize: 13, fontWeight: '600', color: Colors.orange },
  webClearText:      { fontSize: 13, color: '#888888', textDecorationLine: 'underline' as any, paddingHorizontal: 4 },
  webFilterMoreBtn:     { borderWidth: 1, borderColor: '#d0ccc7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fafafa' },
  webFilterMoreBtnText: { fontSize: 13, color: '#555555', fontWeight: '500' },

  // ── Web ledger table ──────────────────────────────────────────────
  webTableHeader:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  webTableHeaderCell: { fontSize: 10, fontWeight: '700', color: '#aaaaaa', letterSpacing: 1.2, textTransform: 'uppercase' as any },
  webRow:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  webRowDimmed:       { opacity: 0.45 },
  webRowCell:         { paddingRight: 16 },
  webRowVenue:        { flexDirection: 'row', alignItems: 'center', gap: 14 },
  webRowThumb:        { width: 54, height: 54, borderRadius: 8 },
  webRowThumbEmpty:   { backgroundColor: '#e8e3dc', alignItems: 'center', justifyContent: 'center' },
  webRowThumbLabel:   { fontSize: 10, color: '#aaaaaa', fontStyle: 'italic' },
  webRowName:         { fontSize: 15, fontWeight: '700', color: '#111111' },
  webRowMeta:         { fontSize: 12, color: '#888888', marginTop: 2 },
  webRowCap:          { fontSize: 15, color: '#111111' },
  webSlotChip:        { backgroundColor: Colors.orange + '20', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  webSlotChipText:    { fontSize: 12, color: Colors.orange, fontWeight: '600' },
  webSlotExtra:       { fontSize: 12, color: '#888888' },
  webSlotNone:        { fontSize: 13, color: '#aaaaaa', fontStyle: 'italic' },
  webRowFee:          { fontSize: 14, fontWeight: '600', color: '#111111' },
  webEnquireBtn:      { backgroundColor: '#111111', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  webEnquireBtnText:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  webWatchBtn:        { borderWidth: 1, borderColor: '#d0d0d0', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  webWatchBtnText:    { fontSize: 13, fontWeight: '500', color: '#888888' },
});
