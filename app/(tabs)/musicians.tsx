import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
  ScrollView, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Colors } from '@/constants/colors';
import { searchSuburbs, type AreaResult } from '@/lib/suburbSearch';
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

const ACT_TYPES = ['Band', 'Solo', 'Duo', 'DJ', 'Other'];

type Musician = {
  id: string; name?: string; artistType?: string;
  location?: string; genre?: string[]; about?: string;
  photoUrl?: string; photoPosition?: { x: number; y: number };
  feeMin?: number; feeMax?: number;
  settings?: { listed?: boolean };
};

const CARD_H = 160;
function CardPhoto({ uri, position }: { uri: string; position?: { x: number; y: number } }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };
  useEffect(() => { Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {}); }, [uri]);
  const scale   = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, CARD_H / dims.nh) : 1;
  const dispW   = dims.nw ? dims.nw * scale : (w || 300);
  const dispH   = dims.nh ? dims.nh * scale : CARD_H;
  const maxTx   = Math.max(0, dispW - w);
  const maxTy   = Math.max(0, dispH - CARD_H);
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

const isWeb = Platform.OS === 'web';
type PanelKey = 'fee' | 'type' | null;

export default function MusiciansScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [musicians, setMusicians]   = useState<Musician[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]                   = useState('');
  const [genres, setGenres]                   = useState<string[]>([]);
  const [actTypes, setActTypes]               = useState<string[]>([]);
  const [feeRanges, setFeeRanges]             = useState<string[]>([]);
  const [showDropdown, setShowDropdown]       = useState(false);
  const [areaSuggestions, setAreaSuggestions] = useState<AreaResult[]>([]);
  const [openPanel, setOpenPanel]             = useState<PanelKey>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'bandProfiles'));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Musician[];
      setMusicians(data.filter(m => m.settings?.listed !== false));
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim().replace(/^@/, '');
    if (q.length < 2) { setAreaSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      try {
        const areas = searchSuburbs(q, 6);
        setAreaSuggestions(areas);
        if (areas.length > 0) setShowDropdown(true);
      } catch { setAreaSuggestions([]); }
    }, 200);
  }, [search]);

  const q = search.trim().toLowerCase();
  const musicianMatches = q.length >= 2
    ? musicians.filter(m => m.name?.toLowerCase().includes(q) || m.location?.toLowerCase().includes(q)).slice(0, 4)
    : [];
  const hasDropdown = musicianMatches.length > 0 || areaSuggestions.length > 0;

  function resetFilters() {
    setSearch(''); setGenres([]); setActTypes([]); setFeeRanges([]);
    setShowDropdown(false); setAreaSuggestions([]); setOpenPanel(null);
  }

  function handleSearchChange(val: string) {
    setSearch(val); setShowDropdown(val.trim().length >= 2);
  }

  function selectMusicianMatch(m: Musician) {
    setSearch(m.name || ''); setAreaSuggestions([]); setShowDropdown(false);
  }

  function selectAreaSuggestion(s: AreaResult) {
    setSearch(s.label); setAreaSuggestions([]); setShowDropdown(false);
  }

  function clearSearch() {
    setSearch(''); setAreaSuggestions([]); setShowDropdown(false);
  }

  function toggleActType(t: string) {
    setActTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function toggleFee(key: string) {
    setFeeRanges(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function toggleGenre(g: string) {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  function togglePanel(p: PanelKey) {
    setOpenPanel(prev => prev === p ? null : p);
  }

  const filtered = musicians.filter(m => {
    if (search) {
      const sq = search.toLowerCase().replace(/^@/, '');
      const match =
        m.name?.toLowerCase().includes(sq) ||
        m.location?.toLowerCase().includes(sq) ||
        (m as any).username?.toLowerCase().includes(sq);
      if (!match) return false;
    }
    if (genres.length > 0) {
      const mg = m.genre || [];
      if (!genres.some(g => mg.includes(g))) return false;
    }
    if (feeRanges.length > 0) {
      const vLo = m.feeMin ?? null; const vHi = m.feeMax ?? null;
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
    if (actTypes.length > 0) {
      const types = Array.isArray(m.artistType) ? m.artistType : (m.artistType ? [m.artistType] : []);
      if (!actTypes.some(t => types.includes(t))) return false;
    }
    return true;
  });

  // Filter pill labels
  const feeActive  = feeRanges.length > 0;
  const typeActive = actTypes.length > 0;

  const feeLabel  = feeActive  ? (feeRanges.length === 1 ? FEE_RANGES.find(r => r.key === feeRanges[0])?.label ?? 'Fee' : `${feeRanges.length} ranges`) : '$ Fee';
  const typeLabel = typeActive ? (actTypes.length === 1 ? actTypes[0] : `${actTypes.length} types`) : 'Act Type';

  // ── Shared search dropdown ────────────────────────────────────────
  const SearchDropdown = (top: number, left: number, right: number) => showDropdown && hasDropdown ? (
    <View style={[st.dropdown, { top, left, right }]}>
      {musicianMatches.length > 0 && (<>
        <Text style={st.dropSection}>MUSICIANS</Text>
        {musicianMatches.map(m => (
          <TouchableOpacity key={m.id} style={st.dropItem} onPress={() => selectMusicianMatch(m)}>
            <Text style={st.dropItemText}>🎵 {m.name}</Text>
            {m.location ? <Text style={st.dropItemMeta}>{m.location}</Text> : null}
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
  ) : null;

  // ── Web sidebar ───────────────────────────────────────────────────
  const WebSidebar = (
    <View style={st.sidebar}>
      <View style={st.sidebarHead}>
        <Text style={st.sidebarTitle}>Filters</Text>
        <TouchableOpacity onPress={resetFilters}><Text style={st.resetAll}>Reset all</Text></TouchableOpacity>
      </View>

      {/* SEARCH */}
      <View style={[st.filterSection, { zIndex: 200, overflow: 'visible' as any }]}>
        <Text style={st.filterLabel}>SEARCH</Text>
        <View style={st.searchWrap}>
          <View style={st.searchRow}>
            <TextInput
              style={[st.filterInput, st.searchInput, search ? st.filterInputOn : null]}
              placeholder="Name or location…" placeholderTextColor="#999"
              value={search} onChangeText={handleSearchChange}
              onFocus={() => hasDropdown && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {search ? <TouchableOpacity style={st.clearX} onPress={clearSearch}><Text style={st.clearXText}>✕</Text></TouchableOpacity> : null}
          </View>
          {SearchDropdown(42, 0, 0)}
        </View>
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

      {/* ACT TYPE */}
      <View style={st.filterSection}>
        <Text style={st.filterLabel}>ACT TYPE</Text>
        {ACT_TYPES.map(t => (
          <TouchableOpacity key={t} style={st.checkRow} onPress={() => toggleActType(t)}>
            <View style={[st.checkbox, actTypes.includes(t) && st.checkboxOn]} />
            <Text style={st.checkLabel}>{t}</Text>
          </TouchableOpacity>
        ))}
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

  // ── Native filter bar ─────────────────────────────────────────────
  const NativeFilterBar = (
    <View style={st.nativeFilterWrap}>
      {/* Search */}
      <View style={st.nativeSearchRow}>
        <TextInput
          style={st.nativeSearchInput}
          placeholder="Name or location…" placeholderTextColor="#999"
          value={search} onChangeText={handleSearchChange}
          onFocus={() => hasDropdown && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        />
        {search ? <TouchableOpacity style={st.nativeClearX} onPress={clearSearch}><Text style={st.clearXText}>✕</Text></TouchableOpacity> : null}
      </View>

      {showDropdown && hasDropdown && (
        <View style={[st.dropdown, { top: 52, left: 16, right: 16 }]}>
          {musicianMatches.length > 0 && (<>
            <Text style={st.dropSection}>MUSICIANS</Text>
            {musicianMatches.map(m => (
              <TouchableOpacity key={m.id} style={st.dropItem} onPress={() => selectMusicianMatch(m)}>
                <Text style={st.dropItemText}>🎵 {m.name}</Text>
                {m.location ? <Text style={st.dropItemMeta}>{m.location}</Text> : null}
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

      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
        <TouchableOpacity style={[st.filterPill, feeActive && st.filterPillOn, openPanel === 'fee' && st.filterPillOpen]} onPress={() => togglePanel('fee')}>
          <Text style={[st.filterPillText, feeActive && st.filterPillTextOn]}>{feeLabel} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.filterPill, typeActive && st.filterPillOn, openPanel === 'type' && st.filterPillOpen]} onPress={() => togglePanel('type')}>
          <Text style={[st.filterPillText, typeActive && st.filterPillTextOn]}>{typeLabel} ▾</Text>
        </TouchableOpacity>
        {(feeActive || typeActive || genres.length > 0) && (
          <TouchableOpacity style={st.resetPill} onPress={resetFilters}>
            <Text style={st.resetPillText}>Reset All</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Fee panel */}
      {openPanel === 'fee' && (
        <View style={st.panel}>
          {FEE_RANGES.map(r => (
            <TouchableOpacity key={r.key} style={st.panelOption} onPress={() => toggleFee(r.key)}>
              <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
              <Text style={st.panelOptionText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Act type panel */}
      {openPanel === 'type' && (
        <View style={st.panel}>
          {ACT_TYPES.map(t => (
            <TouchableOpacity key={t} style={st.panelOption} onPress={() => toggleActType(t)}>
              <View style={[st.checkbox, actTypes.includes(t) && st.checkboxOn]} />
              <Text style={st.panelOptionText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Genre pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.nativePillScroll} contentContainerStyle={st.nativePillRow}>
        <TouchableOpacity style={[st.genrePill, genres.length === 0 && st.genrePillOn]} onPress={() => setGenres([])}>
          <Text style={[st.genrePillText, genres.length === 0 && st.genrePillTextOn]}>All</Text>
        </TouchableOpacity>
        {GENRES.map(g => (
          <TouchableOpacity key={g} style={[st.genrePill, genres.includes(g) && st.genrePillOn]} onPress={() => toggleGenre(g)}>
            <Text style={[st.genrePillText, genres.includes(g) && st.genrePillTextOn]}>{g}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // ── Musician card ─────────────────────────────────────────────────
  function MusicianCard({ item }: { item: Musician }) {
    const actType = Array.isArray(item.artistType) ? item.artistType.join(' / ') : item.artistType;
    return (
      <TouchableOpacity
        activeOpacity={0.97}
        style={[st.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
        onPress={() => router.push(`/musician/${item.id}`)}
      >
        {item.photoUrl
          ? <CardPhoto uri={item.photoUrl} position={item.photoPosition} />
          : <View style={[st.cardPhotoEmpty, { backgroundColor: colors.bgFaint }]}><Text style={[st.cardPhotoLabel, { color: colors.grey }]}>artist photo</Text></View>
        }
        <View style={st.cardBody}>
          <View style={st.nameRow}>
            <Text style={[st.name, { color: colors.black }]}>{item.name || 'Unnamed Act'}</Text>
            {actType ? <View style={st.typeBadge}><Text style={st.typeText}>{actType}</Text></View> : null}
          </View>
          {(item.genre || []).length > 0 && (
            <View style={st.genreRow}>
              {(item.genre || []).map((g: string) => (
                <View key={g} style={st.pill}><Text style={st.pillText}>{g}</Text></View>
              ))}
            </View>
          )}
          {item.location ? <Text style={[st.location, { color: colors.grey }]}>{item.location}</Text> : null}
          {item.about ? <Text style={[st.about, { color: colors.grey }]} numberOfLines={2}>{item.about}</Text> : null}
          <View style={[st.cardFooter, { borderTopColor: colors.borderFaint }]}>
            <TouchableOpacity style={st.profileBtn} onPress={() => router.push('/(tabs)/inbox')}>
              <Text style={st.profileBtnText}>Message</Text>
            </TouchableOpacity>
            <View style={st.cardFooterRight}>
              <TouchableOpacity style={st.actionBtn} onPress={() => router.push(`/musician/${item.id}`)}>
                <Text style={st.actionBtnText}>Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.actionBtn} onPress={() => router.push({ pathname: '/musician/[id]', params: { id: item.id, tab: 'music' } })}>
                <Text style={st.actionBtnText}>Music & Social</Text>
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
        <ScrollView style={[st.sidebarScroll, { borderRightColor: colors.border }]} showsVerticalScrollIndicator={false}>{WebSidebar}</ScrollView>
        <ScrollView
          style={st.contentScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        >
          <View style={st.content}>
            <Text style={[st.pageTitle, { color: colors.black }]}>Find your next act</Text>
            <Text style={[st.countText, { color: colors.grey }]}>{filtered.length} musician{filtered.length !== 1 ? 's' : ''} match your filters</Text>
            {loading
              ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
              : filtered.length === 0
                ? <Text style={[st.empty, { color: colors.grey }]}>No musicians match your filters.</Text>
                : <View style={st.grid}>{filtered.map(item => <View key={item.id} style={{ width: '49%' }}><MusicianCard item={item} /></View>)}</View>
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
        <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>{NativeFilterBar}</View>

        <View style={st.nativeContent}>
          <View style={st.countRow}>
            <Text style={[st.countText, { color: colors.grey }]}>{filtered.length} musician{filtered.length !== 1 ? 's' : ''}</Text>
          </View>
          {loading
            ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
            : filtered.length === 0
              ? <Text style={[st.empty, { color: colors.grey }]}>No musicians match your filters.</Text>
              : filtered.map(item => <MusicianCard key={item.id} item={item} />)
          }
          <View style={{ height: 48 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  page:          { flex: 1, flexDirection: 'row', backgroundColor: '#ffffff' },
  sidebarScroll: { width: 280, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: '#eeeeee' },
  contentScroll: { flex: 1 },

  sidebar:     { padding: 24, paddingTop: 28, paddingBottom: 48 },
  sidebarHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  sidebarTitle:{ fontSize: 18, fontWeight: '700', color: '#111111' },
  resetAll:    { fontSize: 13, color: Colors.orange, fontWeight: '600' },
  filterSection:{ marginBottom: 24 },
  filterLabel: { fontSize: 10, fontWeight: '700', color: '#111111', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  filterInput: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, padding: 9, paddingHorizontal: 12, fontSize: 13, color: '#111111', backgroundColor: '#fafafa' },
  filterInputOn:{ borderColor: Colors.orange, backgroundColor: '#ffffff' },

  searchWrap:  { position: 'relative' as any, zIndex: 200, overflow: 'visible' as any },
  searchRow:   { flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1 },
  clearX:      { position: 'absolute' as any, right: 10, padding: 2 },
  clearXText:  { fontSize: 13, color: '#111111' },

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

  checkRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  checkbox:   { width: 15, height: 15, borderRadius: 3, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  checkLabel: { fontSize: 13, color: '#111111' },

  genreGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:      { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  genrePillOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  genrePillText:  { fontSize: 12, color: '#111111' },
  genrePillTextOn:{ color: '#ffffff', fontWeight: '600' },

  content:   { padding: 36, paddingTop: 32, paddingBottom: 48 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  pageTitle: { fontSize: 32, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginBottom: 4 },
  countText: { fontSize: 13, color: '#666666', marginBottom: 16 },
  empty:     { color: '#111111', fontSize: 14, marginTop: 40 },

  // Native filter bar
  nativeFilterBg:   { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  nativeFilterWrap: { paddingTop: 12, paddingBottom: 8 },
  nativeSearchRow:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10 },
  nativeSearchInput:{
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 10, paddingHorizontal: 14, fontSize: 14, color: '#111111', backgroundColor: '#fafafa',
  },
  nativeClearX:   { paddingLeft: 8 },
  nativePillScroll:{ flexGrow: 0 },
  nativePillRow:  { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingBottom: 6 },

  filterPill:     { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fafafa' },
  filterPillOn:   { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterPillOpen: { borderColor: '#111111', backgroundColor: '#f5f5f5' },
  filterPillText: { fontSize: 13, fontWeight: '600', color: '#555555' },
  filterPillTextOn:{ color: '#ffffff' },
  resetPill:      { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7 },
  resetPillText:  { fontSize: 13, fontWeight: '600', color: Colors.orange },

  panel:          { marginHorizontal: 16, marginBottom: 8, padding: 14, backgroundColor: '#fafafa', borderRadius: 12, borderWidth: 1, borderColor: '#eeeeee' },
  panelOption:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  panelOptionText:{ fontSize: 14, color: '#111111' },

  nativeContent: { paddingHorizontal: 16 },
  countRow:      { paddingTop: 14, paddingBottom: 8 },

  card:           { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  cardPhoto:      { width: '100%', height: 160 },
  cardPhotoEmpty: { width: '100%', height: 160, backgroundColor: '#e3e0d8', alignItems: 'center', justifyContent: 'center' },
  cardPhotoLabel: { fontSize: 12, color: '#111111', fontStyle: 'italic' },
  cardBody:       { padding: 18, paddingHorizontal: 20, gap: 8 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name:           { fontSize: 18, fontWeight: '700', color: '#111111' },
  typeBadge:      { borderRadius: 4, backgroundColor: '#f4f4f4', paddingHorizontal: 8, paddingVertical: 2 },
  typeText:       { fontSize: 11, fontWeight: '600', color: '#111111' },
  genreRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill:           { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  pillText:       { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  location:       { fontSize: 12, color: '#666666' },
  about:          { fontSize: 13, color: '#111111', lineHeight: 19 },
  cardFooter:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  cardFooterRight: { flexDirection: 'row', gap: 8 },
  profileBtn:     { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  profileBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  actionBtn:      { backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  actionBtnText:  { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});
