import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Linking, Platform,
} from 'react-native';
import { Text } from '@/components/Text';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { InstagramPostEmbed } from '@/components/InstagramPostEmbed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

const isWeb = Platform.OS === 'web';

function PositionedBanner({ uri, position, height }: { uri: string; position?: { x: number; y: number }; height: number }) {
  const [w, setW] = useState(0);
  const [dims, setDims] = useState({ nw: 0, nh: 0 });
  const pos = position ?? { x: 50, y: 50 };

  useEffect(() => {
    if (uri) Image.getSize(uri, (nw, nh) => setDims({ nw, nh }), () => {});
  }, [uri]);

  const coverScale = (dims.nw && dims.nh && w) ? Math.max(w / dims.nw, height / dims.nh) : 1.6;
  const displayW   = dims.nw ? dims.nw * coverScale : w * 1.6;
  const displayH   = dims.nh ? dims.nh * coverScale : height * 1.6;
  const maxTx      = Math.max(0, displayW - w);
  const maxTy      = Math.max(0, displayH - height);
  const tx         = -(pos.x / 100) * maxTx;
  const ty         = -(pos.y / 100) * maxTy;

  return (
    <View style={{ height, overflow: 'hidden' }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Image
        source={{ uri }}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: displayW, height: displayH,
          transform: [{ translateX: tx }, { translateY: ty }],
        } as any}
        resizeMode="cover"
      />
    </View>
  );
}

const MAX_DESC = 320;

const PLATFORMS = [
  { key: 'instagram',  label: 'Instagram'   },
  { key: 'tiktok',     label: 'TikTok'      },
  { key: 'spotify',    label: 'Spotify'     },
  { key: 'appleMusic', label: 'Apple Music' },
];

function toSpotifyEmbedUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/open\.spotify\.com\/(artist|track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`;
}

function spotifyEmbedHeight(embedUrl: string): number {
  return embedUrl.includes('/track/') || embedUrl.includes('/episode/') ? 152 : 352;
}

function toInstagramPostUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/);
  return m ? `https://www.instagram.com/${m[1]}/${m[2]}/` : null;
}

function getInstagramHandle(val: string): string | null {
  if (!val) return null;
  const urlMatch = val.match(/instagram\.com\/(?!p\/|reel\/)([^/?#\s]+)/);
  if (urlMatch) return urlMatch[1].replace(/\/$/, '');
  if (/^@?[\w.][\w.]{0,28}$/.test(val.trim())) return val.trim().replace(/^@/, '');
  return null;
}

type CustomLink = { label: string; url: string };
type Song       = { title?: string; url?: string; duration?: string };
type GigEntry   = { venue?: string; suburb?: string; date?: string; attendance?: number; notes?: string };

type Musician = {
  id: string;
  name?: string;
  username?: string;
  artistType?: string | string[];
  actSize?: string;
  location?: string;
  genre?: string[];
  otherGenres?: string;
  otherArtistType?: string;
  photoPosition?: { x: number; y: number };
  about?: string;
  photoUrl?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  tiktok?: string;
  spotify?: string;
  appleMusic?: string;
  website?: string;
  customLinks?: CustomLink[];
  songs?: Song[];
  photos?: string[];
  videos?: string[];
  gigHistory?: GigEntry[];
  upcomingGigs?: GigEntry[];
  feeMin?: number;
  feeMax?: number;
  averageDraw?: number;
  backline?: string;
  availability?: string;
};

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ m }: { m: Musician }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const about          = m.about || '';
  const shouldTruncate = about.length > MAX_DESC;
  const gigHistory     = (m.gigHistory || [])
    .filter(g => g.venue || g.date)
    .slice()
    .sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : NaN;
      const db = b.date ? Date.parse(b.date) : NaN;
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });
  const socialLinks    = PLATFORMS.filter(p => (m as any)[p.key]);
  const customLinks    = (m.customLinks || []).filter(l => l.label && l.url);
  const hasContact     = !!(m.email || m.phone);
  const hasSocials     = socialLinks.length > 0 || customLinks.length > 0;
  const hasFee         = m.feeMin != null || m.feeMax != null;
  const hasSidebar     = hasFee || hasContact || hasSocials || !!m.availability;

  const feeStr = hasFee
    ? (m.feeMin != null && m.feeMax != null
        ? `$${m.feeMin.toLocaleString()} – $${m.feeMax.toLocaleString()}`
        : m.feeMin != null
          ? `From $${m.feeMin.toLocaleString()}`
          : `Up to $${m.feeMax!.toLocaleString()}`)
    : null;

  const sidebar = (
    <View style={isWeb ? styles.overviewSidebar : styles.mobileSidebar}>
      {feeStr && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.greyLight }]}>FEE</Text>
          <Text style={[styles.sideFee, { color: colors.black }]}>{feeStr}</Text>
        </View>
      )}
      {hasContact && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.greyLight }]}>CONTACT</Text>
          {m.email && (
            <TouchableOpacity onPress={() => Linking.openURL(`mailto:${m.email}`)}>
              <Text style={styles.sideLink}>{m.email}</Text>
            </TouchableOpacity>
          )}
          {m.phone && (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${m.phone}`)}>
              <Text style={styles.sideLink}>{m.phone}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {hasSocials && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.greyLight }]}>SOCIALS</Text>
          {socialLinks.map(p => (
            <TouchableOpacity key={p.key} onPress={() => Linking.openURL((m as any)[p.key])}>
              <Text style={styles.sideLink}>{p.label} →</Text>
            </TouchableOpacity>
          ))}
          {customLinks.map((link, i) => (
            <TouchableOpacity key={i} onPress={() => Linking.openURL(link.url)}>
              <Text style={styles.sideLink}>{link.label} →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {m.availability && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.greyLight }]}>AVAILABILITY</Text>
          <Text style={[styles.sideBody, { color: colors.black }]}>{m.availability}</Text>
        </View>
      )}
    </View>
  );

  const main = (
    <View style={isWeb ? styles.overviewMain : undefined}>
      {about ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>ABOUT</Text>
          <Text style={[styles.body, { color: colors.black }]}>
            {shouldTruncate && !expanded ? about.slice(0, MAX_DESC) + '…' : about}
          </Text>
          {shouldTruncate && (
            <TouchableOpacity onPress={() => setExpanded(e => !e)}>
              <Text style={styles.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {gigHistory.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>GIG HISTORY</Text>
          <View style={[styles.gigTableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.gigColVenue, styles.gigTableHdr, { color: colors.greyLight }]}>VENUE</Text>
            <Text style={[styles.gigColSuburb, styles.gigTableHdr, { color: colors.greyLight }]}>SUBURB</Text>
            <Text style={[styles.gigColDraw, styles.gigTableHdr, { color: colors.greyLight }]}>DRAW</Text>
          </View>
          {gigHistory.map((gig, i) => (
            <View key={i} style={[styles.gigTableRow, { borderBottomColor: colors.borderFaint }]}>
              <Text style={[styles.gigColVenue, styles.gigCellText, { color: colors.black }]} numberOfLines={1}>
                {gig.venue || '—'}
              </Text>
              <Text style={[styles.gigColSuburb, styles.gigCellText, { color: colors.grey }]} numberOfLines={1}>
                {gig.suburb || '—'}
              </Text>
              <Text style={[styles.gigColDraw, styles.gigCellText, { color: colors.black }]}>
                {gig.attendance ?? '—'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!about && gigHistory.length === 0 && (
        <Text style={[styles.emptyState, { color: colors.greyLight }]}>No info listed yet.</Text>
      )}
    </View>
  );

  if (isWeb) {
    return (
      <View style={styles.overviewLayout}>
        {main}
        {hasSidebar && <View>{sidebar}</View>}
      </View>
    );
  }

  return (
    <>
      {hasSidebar && <View style={styles.mobileContent}>{sidebar}</View>}
      <View style={styles.mobileContent}>{main}</View>
    </>
  );
}

// ── Music & Social Tab ────────────────────────────────────────────

function MusicTab({ m }: { m: Musician }) {
  const { colors } = useTheme();
  const songs = (m.songs || []).filter(s => s.title);

  const spotifyEmbedUrl = toSpotifyEmbedUrl(m.spotify || '');
  const igPostUrl       = toInstagramPostUrl(m.instagram || '');
  const igHandle        = igPostUrl ? null : getInstagramHandle(m.instagram || '');
  const spHeight        = spotifyEmbedUrl ? spotifyEmbedHeight(spotifyEmbedUrl) : 0;

  const linkItems = [
    m.instagram  ? { label: 'Instagram',   url: m.instagram                 } : null,
    m.spotify    ? { label: 'Spotify',     url: m.spotify                   } : null,
    m.appleMusic ? { label: 'Apple Music', url: m.appleMusic                } : null,
    m.tiktok     ? { label: 'TikTok',      url: m.tiktok                    } : null,
    m.website    ? { label: 'Website',     url: m.website                   } : null,
    m.email      ? { label: 'Email',       url: `mailto:${m.email}`         } : null,
    ...(m.customLinks || []).filter(l => l.label && l.url),
  ].filter(Boolean) as { label: string; url: string }[];

  return (
    <View style={styles.tabContent}>

      {/* TOP TRACKS */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>TOP TRACKS</Text>
        {spotifyEmbedUrl && (
          <View style={[styles.embedWrap, { borderColor: colors.border, marginBottom: songs.length > 0 ? 16 : 0 }]}>
            <SpotifyEmbed url={spotifyEmbedUrl} height={spHeight} />
          </View>
        )}
        {songs.length > 0 ? (
          songs.map((song, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.trackRow, { borderBottomColor: colors.borderFaint }]}
              onPress={() => song.url && Linking.openURL(song.url)}
              disabled={!song.url}
              activeOpacity={song.url ? 0.7 : 1}
            >
              <View style={[styles.trackNum, { backgroundColor: colors.bgFaint }]}>
                <Text style={[styles.trackNumText, { color: colors.grey }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.trackTitle, { color: colors.black }]}>{song.title}</Text>
              <View style={styles.trackMeta}>
                {song.duration
                  ? <Text style={[styles.trackDuration, { color: colors.grey }]}>{song.duration}</Text>
                  : null}
                {song.url && (
                  <View style={styles.playBtn}>
                    <Text style={styles.playBtnText}>▶</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))
        ) : !spotifyEmbedUrl ? (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No tracks listed yet.</Text>
        ) : null}
      </View>

      {/* Instagram */}
      {igPostUrl ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>INSTAGRAM</Text>
          <View style={[styles.embedWrap, { borderColor: colors.border }]}>
            <InstagramPostEmbed postUrl={igPostUrl} />
          </View>
        </View>
      ) : igHandle ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>INSTAGRAM</Text>
          <TouchableOpacity
            style={[styles.igCard, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
            onPress={() => Linking.openURL(`https://www.instagram.com/${igHandle}`)}
            activeOpacity={0.75}
          >
            <View style={styles.igCardLeft}>
              <View style={styles.igAvatar}>
                <Text style={styles.igAvatarText}>IG</Text>
              </View>
              <View>
                <Text style={[styles.igHandle, { color: colors.black }]}>@{igHandle}</Text>
                <Text style={[styles.igSub, { color: colors.grey }]}>View profile on Instagram</Text>
              </View>
            </View>
            <Text style={[styles.igArrow, { color: Colors.orange }]}>→</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* LINKS */}
      {linkItems.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>LINKS</Text>
          <View style={styles.linksGrid}>
            {linkItems.map((link, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.linkCard, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
                onPress={() => Linking.openURL(link.url)}
                activeOpacity={0.75}
              >
                <Text style={[styles.linkCardLabel, { color: colors.black }]}>{link.label}</Text>
                <Text style={[styles.linkCardArrow, { color: Colors.orange }]}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────

export default function MusicianScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const id           = _overrideId ?? String(paramId);
  const isProfileTab = !!_overrideId;
  const router       = useRouter();
  const { user }     = useAuth();
  const { colors }   = useTheme();
  const year         = new Date().getFullYear();

  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/musicians');

  const [musician, setMusician]   = useState<Musician | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'music'>(
    initialTab === 'music' ? 'music' : 'overview'
  );

  const isOwn = user?.uid === id;

  useEffect(() => {
    getDoc(doc(db, 'bandProfiles', id)).then(snap => {
      if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const safeEdges = isProfileTab ? (['bottom'] as const) : undefined;

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!musician) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
        {!isProfileTab && (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.notFound, { color: colors.grey }]}>Musician not found.</Text>
      </SafeAreaView>
    );
  }

  const actType = Array.isArray(musician.artistType)
    ? musician.artistType.join(' / ')
    : musician.artistType === 'Other' && musician.otherArtistType
      ? musician.otherArtistType
      : musician.artistType;

  const baseGenres   = (musician.genre || []).filter(g => g !== 'Other');
  const customGenres = musician.otherGenres
    ? musician.otherGenres.split(',').map(g => g.trim()).filter(Boolean)
    : [];
  const allGenres = [...baseGenres, ...customGenres];

  // Breadcrumb: e.g. BAND · 4PC · MELBOURNE
  const breadcrumbParts = [actType, musician.actSize, musician.location].filter(Boolean) as string[];

  // Auto-count gigs from gigHistory entries whose date contains the current year
  const gigsThisYear = (musician.gigHistory || []).filter(g => g.date && g.date.includes(String(year))).length;

  const statsItems = [
    musician.averageDraw != null ? { value: String(musician.averageDraw), label: 'TYPICAL DRAW' } : null,
    musician.actSize             ? { value: musician.actSize,             label: 'ACT SIZE'     } : null,
    gigsThisYear > 0             ? { value: String(gigsThisYear),         label: `GIGS IN ${year}` } : null,
    musician.backline            ? { value: musician.backline,            label: 'BACKLINE'     } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges ?? ['bottom']}>
      <ScrollView>

        {/* Hero banner */}
        {musician.photoUrl ? (
          <PositionedBanner uri={musician.photoUrl} position={musician.photoPosition} height={isWeb ? 360 : 280} />
        ) : (
          <View style={[styles.bannerPlaceholder, { backgroundColor: colors.bgFaint }]} />
        )}

        {/* Back button overlay */}
        {!isProfileTab && (
          <SafeAreaView edges={['top']} style={styles.backOverlayWrap}>
            <TouchableOpacity style={styles.backOverlay} onPress={handleBack}>
              <Text style={styles.backOverlayText}>← Back</Text>
            </TouchableOpacity>
          </SafeAreaView>
        )}

        {/* Profile header */}
        <View style={[styles.profileHead, { borderBottomColor: colors.border }]}>

          {/* Breadcrumb */}
          {breadcrumbParts.length > 0 && (
            <Text style={styles.breadcrumb}>
              {breadcrumbParts.join(' · ').toUpperCase()}
            </Text>
          )}

          {/* Name + action buttons */}
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.black }]} numberOfLines={2}>
              {musician.name || 'Unnamed Act'}
            </Text>
            {isOwn && (
              <View style={styles.ownerBtns}>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={() => router.push('/edit-profile')}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.black }]}>Edit profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.orangeBtn} activeOpacity={0.75}>
                  <Text style={styles.orangeBtnText}>Preview as venue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={() => signOut(auth)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.grey }]}>Log out</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Handle */}
          {musician.username
            ? <Text style={[styles.username, { color: colors.grey }]}>@{musician.username}</Text>
            : null}

          {/* Genre pills */}
          {allGenres.length > 0 && (
            <View style={styles.genres}>
              {allGenres.map(g => (
                <View key={g} style={styles.genrePill}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Stats row */}
        {statsItems.length > 0 && (
          <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
            {statsItems.map((stat, i) => (
              <View
                key={stat.label}
                style={[
                  styles.statCell,
                  { borderRightColor: colors.border },
                  i === statsItems.length - 1 && { borderRightWidth: 0 },
                ]}
              >
                <Text style={[styles.statValue, { color: colors.black }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.greyLight }]}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
          {([
            { id: 'overview', label: 'Overview'       },
            { id: 'music',    label: 'Music & Social' },
          ] as const).map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[
                styles.tabText,
                { color: activeTab === tab.id ? colors.black : colors.grey },
                activeTab === tab.id && styles.tabTextActive,
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'overview'
          ? <OverviewTab m={musician} />
          : <MusicTab m={musician} />
        }

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const BANNER_H = isWeb ? 360 : 280;

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  bannerPlaceholder: { width: '100%', height: BANNER_H },

  backOverlayWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  backOverlay: {
    alignSelf: 'flex-start', margin: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
  },
  backOverlayText: { fontSize: 14, fontWeight: '600', color: Colors.black },
  backBtn:         { padding: 20 },
  backText:        { fontSize: 15, color: Colors.orange, fontWeight: '600' },
  notFound:        { textAlign: 'center', marginTop: 40, fontSize: 15 },

  // Profile header
  profileHead: {
    paddingHorizontal: isWeb ? 40 : 20,
    paddingTop: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
  },
  breadcrumb: {
    fontSize: 11, fontWeight: '700',
    color: Colors.orange, letterSpacing: 1.4,
    marginBottom: 10,
  },
  nameRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12, marginBottom: 6,
  },
  name: {
    fontSize: isWeb ? 38 : 28, fontWeight: '800',
    letterSpacing: -0.5, flex: 1,
  },
  ownerBtns:      { flexDirection: 'row', gap: 8, flexShrink: 0, marginTop: 4 },
  outlineBtn:     { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  outlineBtnText: { fontSize: 13, fontWeight: '600' },
  orangeBtn:      { backgroundColor: Colors.orange, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  orangeBtnText:  { fontSize: 13, fontWeight: '700', color: '#111111' },
  username:       { fontSize: 13, marginBottom: 10 },
  genres:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  genrePill:      { borderWidth: 1, borderColor: Colors.orange, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  genreText:      { fontSize: 12, color: Colors.orange, fontWeight: '500' },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16,
    borderRightWidth: 1,
  },
  statValue: { fontSize: isWeb ? 18 : 15, fontWeight: '800', letterSpacing: -0.2 },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 3 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: isWeb ? 40 : 0,
  },
  tab:           { paddingVertical: 14, paddingHorizontal: isWeb ? 20 : 18, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:     { borderBottomColor: Colors.orange },
  tabText:       { fontSize: 14, fontWeight: '600' },
  tabTextActive: { fontWeight: '700' },

  // Two-column layout (web)
  overviewLayout:  {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, gap: 40,
  },
  overviewMain:    { flex: 1, paddingBottom: 28 },
  overviewSidebar: { width: 240, gap: 0 },
  mobileSidebar:   { gap: 0 },
  mobileContent:   { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 4 },
  tabContent:      { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  body:      { fontSize: 15, lineHeight: 22 },
  readMore:  { fontSize: 14, color: Colors.orange, fontWeight: '600', marginTop: 8 },
  emptyState:{ fontSize: 14, fontStyle: 'italic' },

  // Sidebar cards
  sideCard: {
    borderWidth: 1, borderRadius: 12,
    padding: 16, marginBottom: 12,
  },
  sideSectionLabel: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  sideFee:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  sideLink: { fontSize: 14, color: Colors.orange, fontWeight: '500', marginBottom: 6 },
  sideBody: { fontSize: 14, lineHeight: 20 },

  // Gig history table
  gigTableHeader: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, marginBottom: 2,
  },
  gigTableRow:   { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1 },
  gigTableHdr:   { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  gigCellText:   { fontSize: 14 },
  gigColVenue:   { flex: 2, paddingRight: 8 },
  gigColSuburb:  { flex: 1.5, paddingRight: 8 },
  gigColDraw:    { width: 48, textAlign: 'right' },

  // Music tab — tracks
  trackRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, gap: 12,
  },
  trackNum: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  trackNumText:  { fontSize: 12, fontWeight: '600' },
  trackTitle:    { flex: 1, fontSize: 14, fontWeight: '600' },
  trackMeta:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackDuration: { fontSize: 13 },
  playBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtnText: { fontSize: 10, color: '#111111', marginLeft: 2 },

  // Links grid
  linksGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  linkCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    width: isWeb ? ('calc(50% - 5px)' as any) : '47%',
  },
  linkCardLabel: { fontSize: 14, fontWeight: '600' },
  linkCardArrow: { fontSize: 16 },

  // Embeds
  embedWrap: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },

  // Instagram profile card
  igCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 12, borderWidth: 1 },
  igCardLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  igAvatar:     { width: 48, height: 48, borderRadius: 14, backgroundColor: '#C13584', alignItems: 'center', justifyContent: 'center' },
  igAvatarText: { color: '#ffffff', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  igHandle:     { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  igSub:        { fontSize: 13 },
  igArrow:      { fontSize: 20, fontWeight: '300' },
});
