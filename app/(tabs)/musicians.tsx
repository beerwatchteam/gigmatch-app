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
  id: string; name?: string; artistType?: string | string[];
  location?: string; genre?: string[]; about?: string;
  photoUrl?: string; photoPosition?: { x: number; y: number };
  feeMin?: number; feeMax?: number;
  averageDraw?: number;
  gigHistory?: { date?: string }[];
  settings?: { listed?: boolean };
};

const CARD_H = 120;
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
const PANEL_W = Math.min(Dimensions.get('window').width * 0.87, 340);

export default function MusiciansScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

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
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [webDropdown, setWebDropdown]         = useState<'genre' | 'acttype' | 'fee' | null>(null);
  const slideAnim   = useRef(new Animated.Value(-PANEL_W)).current;
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
    setShowDropdown(false); setAreaSuggestions([]);
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

  const feeActive  = feeRanges.length > 0;
  const typeActive = actTypes.length > 0;
  const activeFilterCount = (feeActive ? 1 : 0) + (typeActive ? 1 : 0) + (genres.length > 0 ? 1 : 0);

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [
    ...feeRanges.map(k => ({
      key: `fee-${k}`,
      label: FEE_RANGES.find(r => r.key === k)?.label ?? k,
      onRemove: () => setFeeRanges(prev => prev.filter(x => x !== k)),
    })),
    ...actTypes.map(t => ({
      key: `type-${t}`,
      label: t,
      onRemove: () => setActTypes(prev => prev.filter(x => x !== t)),
    })),
    ...genres.map(g => ({ key: `genre-${g}`, label: g, onRemove: () => setGenres(prev => prev.filter(x => x !== g)) })),
  ];

  // ── Native filter bar ─────────────────────────────────────────────
  const NativeFilterBar = (
    <View style={st.nativeFilterWrap}>
      <View style={st.nativeTopRow}>
        <View style={st.nativeSearchBox}>
          <TextInput
            style={st.nativeSearchInput}
            placeholder="Name or location…" placeholderTextColor="#999"
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
            <TouchableOpacity onPress={closeFilterPanel} style={st.fpCloseBtn} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={st.fpCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={st.fpTitle}>Filters</Text>
            <TouchableOpacity onPress={() => resetFilters()} activeOpacity={0.7}>
              <Text style={st.fpReset}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
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

            {/* ACT TYPE */}
            <View style={st.fpSection}>
              <Text style={st.fpSectionTitle}>ACT TYPE</Text>
              <View style={st.genreGrid}>
                {ACT_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[st.genrePill, actTypes.includes(t) && st.genrePillOn]} onPress={() => toggleActType(t)}>
                    <Text style={[st.genrePillText, actTypes.includes(t) && st.genrePillTextOn]}>{t}</Text>
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

          {/* Apply button */}
          <View style={st.fpFooter}>
            <TouchableOpacity style={st.fpApplyBtn} onPress={closeFilterPanel} activeOpacity={0.85}>
              <Text style={st.fpApplyBtnText}>
                Show {filtered.length} musician{filtered.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Backdrop — tap to close */}
        <TouchableOpacity style={st.fpBackdrop} activeOpacity={1} onPress={closeFilterPanel} />
      </View>
    </Modal>
  );

  // ── Musician card ─────────────────────────────────────────────────
  function MusicianCard({ item }: { item: Musician }) {
    const [hovered, setHovered] = useState(false);
    const actType = Array.isArray(item.artistType)
      ? item.artistType.join(' / ')
      : item.artistType;
    const metaParts = [item.location].filter(Boolean);
    const thisYear = new Date().getFullYear();
    const yearShort = String(thisYear).slice(2);
    const gigsThisYear = (item.gigHistory || []).filter(g => g.date && g.date.includes(String(thisYear))).length;
    const feeStr = item.feeMin != null && item.feeMax != null
      ? `$${item.feeMin}–$${item.feeMax}`
      : item.feeMin != null ? `$${item.feeMin}+` : null;
    const stats = [
      item.averageDraw != null  ? { value: String(item.averageDraw),  label: 'DRAW'          } : null,
      feeStr                    ? { value: feeStr,                     label: 'FEE'           } : null,
      gigsThisYear > 0          ? { value: String(gigsThisYear),       label: `GIGS '${yearShort}` } : null,
    ].filter(Boolean) as { value: string; label: string }[];

    return (
      <TouchableOpacity
        activeOpacity={0.97}
        style={[
          st.card,
          { backgroundColor: colors.bg, borderColor: hovered ? Colors.orange : colors.border },
          hovered && st.cardHovered,
        ]}
        onPress={() => router.push(`/musician/${item.id}`)}
        {...(isWeb ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        } : {})}
      >
        {item.photoUrl
          ? <CardPhoto uri={item.photoUrl} position={item.photoPosition} />
          : <View style={[st.cardPhotoEmpty, { backgroundColor: colors.bgFaint }]}><Text style={[st.cardPhotoLabel, { color: colors.grey }]}>artist photo</Text></View>
        }
        <View style={st.cardBody}>
          <View style={st.nameRow}>
            <Text style={[st.name, { color: colors.black, flex: 1 }]} numberOfLines={1}>{item.name || 'Unnamed Act'}</Text>
            {actType ? <View style={st.typeBadge}><Text style={st.typeText}>{actType}</Text></View> : null}
          </View>
          {metaParts.length > 0 && (
            <Text style={[st.meta, { color: colors.grey }]} numberOfLines={1}>{metaParts.join(' · ')}</Text>
          )}
          {(item.genre || []).length > 0 && (
            <View style={st.genreRow}>
              {(item.genre || []).slice(0, 3).map((g: string) => (
                <View key={g} style={st.pill}><Text style={st.pillText}>{g}</Text></View>
              ))}
            </View>
          )}
          {item.about ? (
            <Text style={[st.about, { color: colors.grey }]} numberOfLines={2}>{item.about}</Text>
          ) : null}

          {/* Stats strip */}
          {stats.length > 0 && (
            <View style={[st.statsStrip, { borderTopColor: colors.borderFaint }]}>
              {stats.map((stat, i) => (
                <View key={stat.label} style={[st.statItem, i < stats.length - 1 && { borderRightWidth: 1, borderRightColor: colors.borderFaint }]}>
                  <Text style={[st.statValue, { color: colors.black }]}>{stat.value}</Text>
                  <Text style={[st.statLabel, { color: colors.grey }]}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Action buttons */}
          <View style={[st.cardFooter, { borderTopColor: colors.borderFaint }]}>
            <TouchableOpacity
              style={st.listenBtn}
              onPress={e => {
                e.stopPropagation?.();
                router.push({ pathname: '/musician/[id]', params: { id: item.id, tab: 'music' } });
              }}
              activeOpacity={0.85}
            >
              <Text style={st.listenBtnText}>Listen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.messageBtn}
              onPress={e => {
                e.stopPropagation?.();
                router.push({ pathname: '/messages/[id]', params: { id: item.id, name: item.name || 'Musician' } });
              }}
              activeOpacity={0.85}
            >
              <Text style={st.messageBtnText}>Message</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Web layout ────────────────────────────────────────────────────
  if (isWeb) {
    const isMobileWeb = windowWidth < 768;
    const genreLabel = genres.length === 0 ? 'Genre' : genres.length === 1 ? genres[0] : `Genre: ${genres.length}`;
    const typeLabel  = actTypes.length === 0 ? 'Act Type' : actTypes.length === 1 ? actTypes[0] : `Type: ${actTypes.length}`;
    const feeLabel   = feeRanges.length === 0 ? 'Fee' : feeRanges.length === 1 ? (FEE_RANGES.find(r => r.key === feeRanges[0])?.label ?? 'Fee') : `Fee: ${feeRanges.length}`;

    // ── Mobile web ────────────────────────────────────────────────
    if (isMobileWeb) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {/* Hero — outside ScrollView so it's always fully visible */}
          <View style={[st.mobileWebHero, { backgroundColor: '#f2ede6' }]}>
            <Text style={st.mobileWebHeroTitle}>Find your next act</Text>
            <Text style={st.webHeroSub}>
              {filtered.length} musician{filtered.length !== 1 ? 's' : ''} listed
            </Text>
          </View>

          {/* Filter bar — outside ScrollView so dropdown renders above cards */}
          <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border, zIndex: 100, overflow: 'visible' as any }]}>
            {NativeFilterBar}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
          >
            <View style={[st.nativeContent, { paddingTop: 14 }]}>
              {loading
                ? <ActivityIndicator style={{ marginTop: 40 }} color={Colors.orange} />
                : filtered.length === 0
                  ? <Text style={[st.empty, { paddingTop: 10 }]}>No musicians match your filters.</Text>
                  : filtered.map(item => <MusicianCard key={item.id} item={item} />)
              }
              <View style={{ height: 48 }} />
            </View>
          </ScrollView>
          {FilterPanel}
        </View>
      );
    }

    // ── Desktop web ───────────────────────────────────────────────
    return (
      <View style={{ flex: 1, backgroundColor: '#f2ede6' }}>

        {/* ── Hero (outside ScrollView) ─────────────────────────── */}
        <View style={st.webHero}>
          <View style={st.webHeroInner}>
            <View style={{ flex: 1 }}>
              <Text style={st.webHeroTitle}>Find your next act</Text>
              <Text style={st.webHeroSub}>
                {filtered.length} musician{filtered.length !== 1 ? 's' : ''} listed
              </Text>
            </View>
            {/* Search */}
            <View style={{ width: 340, zIndex: 200 } as any}>
              <View style={{ position: 'relative' as any, zIndex: 200 }}>
                <View style={st.webSearchRow}>
                  <View style={{ flex: 1, position: 'relative' as any }}>
                    <TextInput
                      style={[st.webSearchInput, search ? { paddingRight: 36 } : null]}
                      placeholder="Name or location"
                      placeholderTextColor="#999"
                      value={search}
                      onChangeText={handleSearchChange}
                      onFocus={() => hasDropdown && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    />
                    {search ? (
                      <TouchableOpacity
                        style={{ position: 'absolute' as any, right: 10, top: 0, bottom: 0, justifyContent: 'center' }}
                        onPress={clearSearch}
                      >
                        <Text style={{ fontSize: 14, color: '#999', fontWeight: '600' }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <TouchableOpacity style={st.webSearchBtn} onPress={() => setShowDropdown(false)}>
                    <Text style={st.webSearchBtnText}>Search</Text>
                  </TouchableOpacity>
                </View>
                {showDropdown && hasDropdown && (
                  <View style={[st.dropdown, { top: 48, left: 0, right: 0, zIndex: 9999 }]}>
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
              </View>
            </View>
          </View>
        </View>

        {/* Backdrop: zIndex 10, filter bar: zIndex 20 → filter bar always wins */}
        {webDropdown !== null && (
          <TouchableOpacity
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 } as any}
            activeOpacity={1}
            onPress={() => setWebDropdown(null)}
          />
        )}

        {/* ── Filter chip bar (outside ScrollView) ──────────────── */}
        <View style={[st.webFilterBar, { zIndex: 20, position: 'relative' as any }]}>
          <View style={st.webFilterInner}>

            {/* Genre dropdown */}
            <View style={{ position: 'relative' as any, zIndex: 200 }}>
              <TouchableOpacity
                style={[st.webFilterPill, genres.length > 0 && st.webFilterPillActive]}
                onPress={() => setWebDropdown(d => d === 'genre' ? null : 'genre')}
                activeOpacity={0.8}
              >
                <Text style={[st.webFilterPillText, genres.length > 0 && st.webFilterPillTextActive]}>
                  {genreLabel} ▾
                </Text>
              </TouchableOpacity>
              {webDropdown === 'genre' && (
                <View style={[st.webFilterDropdown, { width: 260 }]}>
                  <View style={st.genreGrid}>
                    {GENRES.map(g => (
                      <TouchableOpacity key={g} style={[st.genrePill, genres.includes(g) && st.genrePillOn]} onPress={() => toggleGenre(g)}>
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

            {/* Act Type dropdown */}
            <View style={{ position: 'relative' as any, zIndex: 200 }}>
              <TouchableOpacity
                style={[st.webFilterPill, actTypes.length > 0 && st.webFilterPillActive]}
                onPress={() => setWebDropdown(d => d === 'acttype' ? null : 'acttype')}
                activeOpacity={0.8}
              >
                <Text style={[st.webFilterPillText, actTypes.length > 0 && st.webFilterPillTextActive]}>
                  {typeLabel} ▾
                </Text>
              </TouchableOpacity>
              {webDropdown === 'acttype' && (
                <View style={st.webFilterDropdown}>
                  {ACT_TYPES.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[st.webDropdownOption, actTypes.includes(t) && st.webDropdownOptionActive]}
                      onPress={() => toggleActType(t)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[st.checkbox, actTypes.includes(t) && st.checkboxOn]} />
                        <Text style={[st.webDropdownOptionText, actTypes.includes(t) && st.webDropdownOptionTextActive]}>{t}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {actTypes.length > 0 && (
                    <TouchableOpacity style={{ marginTop: 8, paddingHorizontal: 10 }} onPress={() => setActTypes([])}>
                      <Text style={{ fontSize: 12, color: Colors.orange, fontWeight: '600' }}>Clear</Text>
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
                  {feeLabel} ▾
                </Text>
              </TouchableOpacity>
              {webDropdown === 'fee' && (
                <View style={st.webFilterDropdown}>
                  {FEE_RANGES.map(r => (
                    <TouchableOpacity key={r.key} style={[st.webDropdownOption, feeRanges.includes(r.key) && st.webDropdownOptionActive]} onPress={() => toggleFee(r.key)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[st.checkbox, feeRanges.includes(r.key) && st.checkboxOn]} />
                        <Text style={[st.webDropdownOptionText, feeRanges.includes(r.key) && st.webDropdownOptionTextActive]}>{r.label}</Text>
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

        {/* ── Card grid (scrollable) ────────────────────────────── */}
        <ScrollView
          style={{ flex: 1, backgroundColor: '#ffffff' }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        >
          <View style={{ padding: 32, paddingTop: 28 }}>
            {loading
              ? <ActivityIndicator style={{ marginTop: 60, marginBottom: 60 }} color={Colors.orange} />
              : filtered.length === 0
                ? <Text style={st.empty}>No musicians match your filters.</Text>
                : (
                  <View style={st.webGrid}>
                    {filtered.map(item => (
                      <View key={item.id} style={st.webGridItem}>
                        <MusicianCard item={item} />
                      </View>
                    ))}
                  </View>
                )
            }
            <View style={{ height: 60 }} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Native layout ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={[st.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Filter bar — outside ScrollView so dropdown always renders on top */}
      <View style={[st.nativeFilterBg, { backgroundColor: colors.bg, borderBottomColor: colors.border, zIndex: 100, overflow: 'visible' as any }]}>
        {NativeFilterBar}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.orange} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={st.nativeContent}>
          {/* Header */}
          <View style={st.nativeHeader}>
            <Text style={[st.nativeTitle, { color: colors.black }]}>Find your next act</Text>
            <Text style={[st.nativeSub, { color: colors.grey }]}>
              {filtered.length} musician{filtered.length !== 1 ? 's' : ''} listed
            </Text>
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
      {FilterPanel}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },

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

  checkbox:   { width: 15, height: 15, borderRadius: 3, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  checkboxOn: { backgroundColor: Colors.orange, borderColor: Colors.orange },

  genreGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genrePill:      { borderRadius: 20, borderWidth: 1, borderColor: '#dddddd', paddingHorizontal: 12, paddingVertical: 4 },
  genrePillOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  genrePillText:  { fontSize: 12, color: '#111111' },
  genrePillTextOn:{ color: '#ffffff', fontWeight: '600' },

  empty: { color: '#888888', fontSize: 14, marginTop: 40, textAlign: 'center' },

  // ── Native filter bar ─────────────────────────────────────────────
  nativeFilterBg:    { borderBottomWidth: 1 },
  nativeFilterWrap:  { paddingTop: 12, paddingBottom: 8 },
  nativeTopRow:      { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  nativeSearchBox:   { flex: 1, position: 'relative' as any },
  nativeSearchInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 10, paddingHorizontal: 14, paddingRight: 36,
    fontSize: 14, color: '#111111', backgroundColor: '#fafafa',
  },
  nativeClearX:    { position: 'absolute' as any, right: 12, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  clearXText:      { fontSize: 13, color: '#111111' },
  nativePillScroll:{ flexGrow: 0 },
  nativePillRow:   { paddingHorizontal: 16, gap: 8, flexDirection: 'row', paddingBottom: 6 },

  filterIconBtn:      { borderRadius: 10, borderWidth: 1.5, borderColor: '#dddddd', padding: 10, backgroundColor: '#fafafa', position: 'relative' as any },
  filterIconBtnOn:    { backgroundColor: Colors.orange, borderColor: Colors.orange },
  filterIconBadge:    { position: 'absolute' as any, top: -5, right: -5, backgroundColor: '#111111', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  filterIconBadgeText:{ color: '#ffffff', fontSize: 9, fontWeight: '800', lineHeight: 16 },

  activeChip:     { borderRadius: 20, borderWidth: 1, borderColor: Colors.orange, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.orange + '18' },
  activeChipText: { fontSize: 12, fontWeight: '600', color: Colors.orange },
  resetPill:      { borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 14, paddingVertical: 7 },
  resetPillText:  { fontSize: 13, fontWeight: '600', color: Colors.orange },

  // ── Filter panel ──────────────────────────────────────────────────
  fpOverlay:    { flex: 1, flexDirection: 'row' },
  fpPanel: {
    width: PANEL_W, backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: 6, height: 0 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16,
  },
  fpBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  fpHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  fpCloseBtn:    { width: 32, alignItems: 'flex-start' },
  fpCloseText:   { fontSize: 18, color: '#555555', fontWeight: '400' },
  fpTitle:       { fontSize: 17, fontWeight: '700', color: '#111111' },
  fpReset:       { fontSize: 13, fontWeight: '600', color: Colors.orange, width: 42, textAlign: 'right' },
  fpSection:     { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 4 },
  fpSectionTitle:{ fontSize: 10, fontWeight: '700', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  fpOptionRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  fpOptionText:  { fontSize: 14, color: '#111111' },
  fpFooter:      { padding: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: '#eeeeee' },
  fpApplyBtn:    { backgroundColor: Colors.orange, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  fpApplyBtnText:{ fontSize: 16, fontWeight: '700', color: '#111111' },

  // ── Native layout ─────────────────────────────────────────────────
  nativeContent: { paddingHorizontal: 16 },
  nativeHeader:  { paddingTop: 20, paddingBottom: 12 },
  nativeTitle:   { fontSize: 26, fontWeight: '800', color: '#111111', letterSpacing: -0.5 },
  nativeSub:     { fontSize: 13, color: '#666666', marginTop: 3 },

  // ── Musician card ─────────────────────────────────────────────────
  card:           { borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  cardHovered:    { transform: [{ scale: 1.012 }], shadowColor: Colors.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 8 },
  cardPhotoEmpty: { width: '100%', height: CARD_H, alignItems: 'center', justifyContent: 'center' },
  cardPhotoLabel: { fontSize: 12, fontStyle: 'italic' },
  cardBody:       { padding: 14, paddingHorizontal: 16, gap: 7 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name:           { fontSize: 18, fontWeight: '700', color: '#111111' },
  typeBadge:      { borderRadius: 4, backgroundColor: '#f4f4f4', paddingHorizontal: 8, paddingVertical: 2 },
  typeText:       { fontSize: 11, fontWeight: '600', color: '#555555' },
  meta:           { fontSize: 12, color: '#666666' },
  genreRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill:           { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 },
  pillText:       { fontSize: 11, color: Colors.orange, fontWeight: '500' },
  about:          { fontSize: 13, lineHeight: 19 },

  statsStrip:    { flexDirection: 'row', borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  statItem:      { flex: 1, gap: 3 },
  statValue:     { fontSize: 14, fontWeight: '700', letterSpacing: -0.3 },
  statLabel:     { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' as const },
  cardFooter:    { flexDirection: 'row', gap: 10, paddingTop: 14, marginTop: 4, borderTopWidth: 1 },
  listenBtn:     { flex: 1, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.orange, paddingVertical: 9, alignItems: 'center' },
  listenBtnText: { fontSize: 14, fontWeight: '700', color: Colors.orange },
  messageBtn:    { flex: 1, borderRadius: 10, backgroundColor: '#111111', paddingVertical: 9, alignItems: 'center' },
  messageBtnText:{ fontSize: 14, fontWeight: '700', color: '#ffffff' },

  // ── Mobile web hero ───────────────────────────────────────────────
  mobileWebHero:      { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 },
  mobileWebHeroTitle: { fontSize: 30, fontWeight: '800', color: '#111111', letterSpacing: -0.5, marginTop: 6, lineHeight: 36 },

  // ── Web hero ──────────────────────────────────────────────────────
  webHero:        { backgroundColor: '#f2ede6', paddingHorizontal: 32, paddingTop: 48, paddingBottom: 40, zIndex: 50, overflow: 'visible' as any },
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
  webFilterBar:            { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e0dbd4', borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  webFilterInner:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 12, gap: 8, flexWrap: 'wrap' as any },
  webFilterPill:           { borderWidth: 1, borderColor: '#d0ccc7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#ffffff' },
  webFilterPillActive:     { borderColor: Colors.orange, backgroundColor: Colors.orange + '12' },
  webFilterPillText:       { fontSize: 13, color: '#333333', fontWeight: '500' },
  webFilterPillTextActive: { color: Colors.orange, fontWeight: '600' },
  webFilterDropdown: {
    position: 'absolute' as any, top: '110%' as any, left: 0, marginTop: 4,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e0e0e0',
    borderRadius: 10, padding: 14, zIndex: 300, minWidth: 180,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 12,
  },
  webDropdownOption:           { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 6 },
  webDropdownOptionActive:     { backgroundColor: Colors.orange + '18' },
  webDropdownOptionText:       { fontSize: 13, color: '#333333' },
  webDropdownOptionTextActive: { color: Colors.orange, fontWeight: '600' },
  webClearText:                { fontSize: 13, color: '#888888', textDecorationLine: 'underline' as any, paddingHorizontal: 4 },

  // ── Web card grid ─────────────────────────────────────────────────
  webGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  webGridItem: { width: '31%' },
});
