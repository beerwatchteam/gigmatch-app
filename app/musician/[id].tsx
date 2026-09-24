import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Linking, Platform, useWindowDimensions,
} from 'react-native';
import { Text } from '@/components/Text';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { InstagramPostEmbed } from '@/components/InstagramPostEmbed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { MyGigsContent } from '@/app/(tabs)/gigs';
import { DashboardContent } from '@/app/dashboard';
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
type GigEntry   = { venue?: string; suburb?: string; date?: string; endDate?: string; attendance?: number; notes?: string; socialPostUrl?: string; ticketUrl?: string; type?: string };

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
  payment?: { typicalFee?: string; minimumFee?: string; publicLiabilityHeld?: boolean };
  averageDraw?: number;
  gigsPlayed?: number;
  memberCount?: string;
  setType?: string;
  ageRestriction?: string;
  backline?: string;
  availability?: string;
  techRider?: {
    monitoring?: string;
    backlineNeeded?: string;
    stageSize?: string;
    soundcheck?: string;
    notes?: string;
  };
  techRiderDocs?: { url: string; name: string }[];
  instruments?: string[];
};

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ m, isMobileLayout, publicGigs = [], isOwn = false }: { m: Musician; isMobileLayout: boolean; publicGigs?: any[]; isOwn?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'agentRoster'), where('artistUid', '==', m.id)))
      .then(async snap => {
        if (snap.empty) return;
        const data = snap.docs[0].data();
        if (data.agentName) { setAgentName(data.agentName); return; }
        const userSnap = await getDoc(doc(db, 'users', data.agentUid));
        setAgentName(userSnap.data()?.displayName ?? null);
      })
      .catch(() => {});
  }, [m.id]);

  const about          = m.about || '';
  const shouldTruncate = about.length > MAX_DESC;
  const now            = new Date();

  // publicGigs is the owner's full gig list (any source/visibility) when
  // isOwn, or the public-only projection otherwise, decided by the parent.
  // Public projections never carry a status field (they only ever exist
  // while confirmed); raw gigs docs (owner's own view) do, so check it there.
  const confirmedGigs  = publicGigs.filter(g => g.startAt && g.venueName && (g.status == null || g.status === 'confirmed'));
  const upcomingGigs   = confirmedGigs
    .filter(g => g.startAt.toDate() >= now)
    .sort((a, b) => a.startAt.toDate().getTime() - b.startAt.toDate().getTime())
    .map(g => ({ venue: g.venueName, suburb: g.locationText, date: isoDate(g.startAt.toDate()) } as GigEntry));
  const gigHistory     = confirmedGigs
    .filter(g => g.startAt.toDate() < now)
    .sort((a, b) => b.startAt.toDate().getTime() - a.startAt.toDate().getTime())
    .map(g => ({
      venue:      g.venueName,
      suburb:     g.locationText,
      date:       isoDate(g.startAt.toDate()),
      attendance: g.attendance,
    } as GigEntry));
  const awayPeriods    = ((m as any).awayPeriods ?? []) as { from: string; to?: string; notes?: string }[];
  const hasGigsSummary = upcomingGigs.length > 0 || gigHistory.length > 0 || awayPeriods.length > 0;
  const gigsSectionTitle = isOwn ? 'My Gigs' : `${m.name || 'Artist'} Gigs`;
  const socialLinks    = PLATFORMS.filter(p => (m as any)[p.key]);
  const customLinks    = (m.customLinks || []).filter(l => l.label && l.url);
  const hasContact     = !!(m.email || m.phone);
  const hasSocials     = socialLinks.length > 0 || customLinks.length > 0;
  const hasTechRider   = !!(m.techRider && Object.values(m.techRider).some(v => v));
  const hasTechDocs    = !!(m.techRiderDocs && m.techRiderDocs.length > 0);
  const hasSidebar     = hasContact || hasSocials || !!m.availability || hasTechRider || hasTechDocs;

  // Inline "Add +" link to edit-profile tab (owner view only)
  const addBtn = (tab: string) => (
    <TouchableOpacity onPress={() => router.push(`/edit-profile?tab=${encodeURIComponent(tab)}` as any)} activeOpacity={0.75}>
      <Text style={{ color: Colors.orange, fontSize: 12, fontWeight: '700' }}>Add +</Text>
    </TouchableOpacity>
  );

  // Section heading row: label left, optional Add+ right
  const secHead = (label: string, isEmpty: boolean, tab: string, labelStyle?: any) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={[labelStyle ?? styles.sectionLabel, { color: colors.black }]}>{label}</Text>
      {isOwn && isEmpty && addBtn(tab)}
    </View>
  );

  const sidebar = (
    <View style={!isMobileLayout ? styles.overviewSidebar : styles.mobileSidebar}>
      {(hasContact || isOwn) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          {secHead('Contact', !hasContact, 'Basic Info', styles.sideSectionLabel)}
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
      {(hasSocials || isOwn) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          {secHead('Socials', !hasSocials, 'Basic Info', styles.sideSectionLabel)}
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
      {(m.availability || isOwn) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          {secHead('Availability', !m.availability, 'Basic Info', styles.sideSectionLabel)}
          {m.availability && <Text style={[styles.sideBody, { color: colors.black }]}>{m.availability}</Text>}
        </View>
      )}
      {(hasTechRider || hasTechDocs || isOwn) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          {secHead('Tech Rider', !hasTechRider && !hasTechDocs, 'Tech Rider', styles.sideSectionLabel)}
          {m.techRider?.monitoring && (
            <Text style={[styles.sideBody, { color: colors.black, marginBottom: 4 }]}>
              <Text style={{ fontWeight: '700' }}>Monitoring: </Text>{m.techRider.monitoring}
            </Text>
          )}
          {m.techRider?.backlineNeeded && (
            <Text style={[styles.sideBody, { color: colors.black, marginBottom: 4 }]}>
              <Text style={{ fontWeight: '700' }}>Backline: </Text>{m.techRider.backlineNeeded}
            </Text>
          )}
          {m.techRider?.stageSize && (
            <Text style={[styles.sideBody, { color: colors.black, marginBottom: 4 }]}>
              <Text style={{ fontWeight: '700' }}>Stage: </Text>{m.techRider.stageSize}
            </Text>
          )}
          {m.techRider?.soundcheck && (
            <Text style={[styles.sideBody, { color: colors.black, marginBottom: 4 }]}>
              <Text style={{ fontWeight: '700' }}>Soundcheck: </Text>{m.techRider.soundcheck}
            </Text>
          )}
          {m.techRider?.notes && (
            <Text style={[styles.sideBody, { color: colors.greyLight, marginTop: 4, marginBottom: hasTechDocs ? 8 : 0 }]}>{m.techRider.notes}</Text>
          )}
          {hasTechDocs && (
            <View style={{ marginTop: hasTechRider ? 10 : 0 }}>
              <Text style={[styles.sideSectionLabel, { color: colors.black, marginBottom: 6 }]}>Spec Sheets</Text>
              {(m.techRiderDocs || []).map((doc, i) => (
                <TouchableOpacity key={i} onPress={() => Linking.openURL(doc.url)}>
                  <Text style={[styles.sideLink, { marginBottom: 6 }]}>↓ {doc.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );

  const main = (
    <View style={!isMobileLayout ? styles.overviewMain : undefined}>
      {agentName ? (
        <Text style={[styles.managedBy, { color: colors.grey }]}>Managed by {agentName}</Text>
      ) : null}

      {/* About */}
      {(about || isOwn) ? (
        <View style={styles.section}>
          {secHead('About', !about, 'About')}
          {about ? (
            <>
              <Text style={[styles.body, { color: colors.black }]}>
                {shouldTruncate && !expanded ? about.slice(0, MAX_DESC) + '…' : about}
              </Text>
              {shouldTruncate && (
                <TouchableOpacity onPress={() => setExpanded(e => !e)}>
                  <Text style={styles.readMore}>{expanded ? 'Read less' : 'Read more'}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : null}
        </View>
      ) : null}

      {/* Instruments */}
      {((m.instruments && m.instruments.length > 0) || isOwn) ? (
        <View style={styles.section}>
          {secHead('Instruments', !(m.instruments && m.instruments.length > 0), 'Basic Info')}
          {m.instruments && m.instruments.length > 0 && (
            <View style={styles.genres}>
              {m.instruments.map(inst => (
                <View key={inst} style={[styles.genrePill, { borderColor: colors.border }]}>
                  <Text style={[styles.genreText, { color: colors.black }]}>{inst}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Gigs: a lightweight summary reading from the same data as My Gigs.
          Never shows fee or payment status here, that's for My Gigs itself. */}
      {(hasGigsSummary || isOwn) ? (
        <View style={styles.section}>
          {secHead(gigsSectionTitle, !hasGigsSummary, 'My Gigs')}

          {upcomingGigs.length > 0 && (
            <View style={styles.gigGroup}>
              <Text style={[styles.gigGroupLabel, { color: colors.greyLight }]}>UPCOMING</Text>
              {upcomingGigs.map((gig, i) => (
                <Text key={i} style={[styles.gigLine, { color: colors.black }]} numberOfLines={1}>
                  {gig.venue}{gig.suburb ? `, ${gig.suburb}` : ''}{gig.date ? ` · ${gig.date}` : ''}
                </Text>
              ))}
            </View>
          )}

          {gigHistory.length > 0 && (
            <View style={styles.gigGroup}>
              <Text style={[styles.gigGroupLabel, { color: colors.greyLight }]}>PAST</Text>
              {gigHistory.map((gig, i) => (
                <Text key={i} style={[styles.gigLine, { color: colors.black }]} numberOfLines={1}>
                  {gig.venue}{gig.suburb ? `, ${gig.suburb}` : ''}{gig.date ? ` · ${gig.date}` : ''}{gig.attendance != null ? ` · ~${gig.attendance} draw` : ''}
                </Text>
              ))}
            </View>
          )}

          {awayPeriods.length > 0 && (
            <View style={styles.gigGroup}>
              <Text style={[styles.gigGroupLabel, { color: colors.greyLight }]}>AWAY</Text>
              {awayPeriods.map((p, i) => (
                <Text key={i} style={[styles.gigLine, { color: colors.black }]} numberOfLines={1}>
                  {p.to && p.to !== p.from ? `${prettyAwayDate(p.from)} to ${prettyAwayDate(p.to)}` : prettyAwayDate(p.from)}
                </Text>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Public empty state (never shown to owner) */}
      {!isOwn && !about && !hasGigsSummary && !(m.instruments && m.instruments.length > 0) && (
        <Text style={[styles.emptyState, { color: colors.greyLight }]}>No info listed yet.</Text>
      )}
    </View>
  );

  if (isMobileLayout) {
    return (
      <>
        <View style={styles.mobileContent}>{main}</View>
        {(hasSidebar || isOwn) && <View style={styles.mobileContent}>{sidebar}</View>}
      </>
    );
  }

  return (
    <View style={styles.overviewLayout}>
      {main}
      {(hasSidebar || isOwn) && <View>{sidebar}</View>}
    </View>
  );
}

// ── Music & Social Tab ────────────────────────────────────────────

function MusicTab({ m, isOwn = false }: { m: Musician; isOwn?: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const songs = (m.songs || []).filter(s => s.title);

  const spotifyEmbedUrl = toSpotifyEmbedUrl(m.spotify || '');
  const igPostUrl       = toInstagramPostUrl(m.instagram || '');
  const igHandle        = igPostUrl ? null : getInstagramHandle(m.instagram || '');
  const spHeight        = spotifyEmbedUrl ? spotifyEmbedHeight(spotifyEmbedUrl) : 0;

  const linkItems = [
    m.instagram  ? { label: 'Instagram',   url: m.instagram         } : null,
    m.spotify    ? { label: 'Spotify',     url: m.spotify           } : null,
    m.appleMusic ? { label: 'Apple Music', url: m.appleMusic        } : null,
    m.tiktok     ? { label: 'TikTok',      url: m.tiktok            } : null,
    m.website    ? { label: 'Website',     url: m.website           } : null,
    m.email      ? { label: 'Email',       url: `mailto:${m.email}` } : null,
    ...(m.customLinks || []).filter(l => l.label && l.url),
  ].filter(Boolean) as { label: string; url: string }[];

  const hasMusic = songs.length > 0 || !!spotifyEmbedUrl;
  const hasIg    = !!(igPostUrl || igHandle);
  const hasLinks = linkItems.length > 0;

  const addBtn = (tab: string) => (
    <TouchableOpacity onPress={() => router.push(`/edit-profile?tab=${encodeURIComponent(tab)}` as any)} activeOpacity={0.75}>
      <Text style={{ color: Colors.orange, fontSize: 12, fontWeight: '700' }}>Add +</Text>
    </TouchableOpacity>
  );

  const secHead = (label: string, isEmpty: boolean, tab: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={[styles.sectionLabel, { color: colors.greyLight }]}>{label}</Text>
      {isOwn && isEmpty && addBtn(tab)}
    </View>
  );

  return (
    <View style={styles.tabContent}>

      {/* TOP TRACKS */}
      <View style={styles.section}>
        {secHead('TOP TRACKS', !hasMusic, 'Music')}
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
                {song.duration ? <Text style={[styles.trackDuration, { color: colors.grey }]}>{song.duration}</Text> : null}
                {song.url && <View style={styles.playBtn}><Text style={styles.playBtnText}>▶</Text></View>}
              </View>
            </TouchableOpacity>
          ))
        ) : !spotifyEmbedUrl && !isOwn ? (
          <Text style={[styles.emptyState, { color: colors.greyLight }]}>No tracks listed yet.</Text>
        ) : null}
      </View>

      {/* INSTAGRAM */}
      {(hasIg || isOwn) && (
        <View style={styles.section}>
          {secHead('INSTAGRAM', !hasIg, 'Basic Info')}
          {igPostUrl ? (
            <View style={[styles.embedWrap, { borderColor: colors.border }]}>
              <InstagramPostEmbed postUrl={igPostUrl} />
            </View>
          ) : igHandle ? (
            <TouchableOpacity
              style={[styles.igCard, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}
              onPress={() => Linking.openURL(`https://www.instagram.com/${igHandle}`)}
              activeOpacity={0.75}
            >
              <View style={styles.igCardLeft}>
                <View style={styles.igAvatar}><Text style={styles.igAvatarText}>IG</Text></View>
                <View>
                  <Text style={[styles.igHandle, { color: colors.black }]}>@{igHandle}</Text>
                  <Text style={[styles.igSub, { color: colors.grey }]}>View profile on Instagram</Text>
                </View>
              </View>
              <Text style={[styles.igArrow, { color: Colors.orange }]}>→</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* LINKS */}
      {(hasLinks || isOwn) && (
        <View style={styles.section}>
          {secHead('LINKS', !hasLinks, 'Basic Info')}
          {hasLinks && (
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
          )}
        </View>
      )}
    </View>
  );
}

// ── Timetable helpers ──────────────────────────────────────────────

const SHORT_MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MO  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function prettyAwayDate(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) return iso;
  return `${d} ${SHORT_MO[mo - 1]} ${y}`;
}

type EntryItem = { date: Date; dateISO: string; entry: GigEntry };
type MonthGroup = { year: number; month: number; items: EntryItem[] };

function groupByMonth(items: EntryItem[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  items.forEach(item => {
    const y = item.date.getFullYear(), mo = item.date.getMonth();
    let g = groups.find(g => g.year === y && g.month === mo);
    if (!g) { g = { year: y, month: mo, items: [] }; groups.push(g); }
    g.items.push(item);
  });
  return groups;
}

function MusicianCalendarMonth({ entries, month, year, today, windowStart, windowEnd, colors }: {
  entries: GigEntry[]; month: number; year: number; today: Date;
  windowStart: Date; windowEnd: Date; colors: any;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, GigEntry[]>();
  entries.forEach(e => {
    if (!e.date) return;
    const isAwayRange = (e.type || 'gig') === 'away' && e.endDate && e.endDate > e.date;
    if (isAwayRange) {
      const cur = new Date(e.date); cur.setHours(0,0,0,0);
      const end = new Date(e.endDate!); end.setHours(0,0,0,0);
      while (cur <= end) {
        const iso = isoDate(cur);
        const a = byDate.get(iso) || []; a.push(e); byDate.set(iso, a);
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      const a = byDate.get(e.date) || []; a.push(e); byDate.set(e.date, a);
    }
  });

  return (
    <View style={mt.calMonth}>
      <Text style={[mt.calMonthLabel, { color: colors.black }]}>{LONG_MO[month]} {year}</Text>
      <View style={mt.calDowRow}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <Text key={i} style={[mt.calDow, { color: colors.greyLight }]}>{d}</Text>
        ))}
      </View>
      <View style={mt.calGrid}>
        {cells.map((dayNum, ci) => {
          if (!dayNum) return <View key={`e${ci}`} style={mt.calCell} />;
          const date = new Date(year, month, dayNum);
          const iso = isoDate(date);
          const todayN = new Date(today); todayN.setHours(0,0,0,0);
          const dateN = new Date(date); dateN.setHours(0,0,0,0);
          const wsN = new Date(windowStart); wsN.setHours(0,0,0,0);
          const weN = new Date(windowEnd); weN.setHours(0,0,0,0);
          const outOfRange = dateN < wsN || dateN > weN;
          const isToday = dateN.getTime() === todayN.getTime();
          const dayEntries = byDate.get(iso) || [];
          const hasGig  = dayEntries.some(e => (e.type || 'gig') === 'gig');
          const hasAway = dayEntries.some(e => (e.type || 'gig') === 'away');
          const numColor = isToday ? '#ffffff' : outOfRange ? colors.greyLight : hasAway ? colors.greyLight : colors.black;
          return (
            <View key={`${year}-${month}-${dayNum}`} style={mt.calCell}>
              <View style={[mt.calDayCircle, isToday && !hasAway && mt.calDayCircleToday]}>
                <Text style={[mt.calDayNum, { color: numColor }, !outOfRange && hasAway && { textDecorationLine: 'line-through' as const }]}>{dayNum}</Text>
              </View>
              <View style={mt.calDots}>
                {!outOfRange && hasGig && <View style={[mt.calDot, { backgroundColor: '#22c55e' }]} />}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MusEntryRow({ entry, date, isOwn, musicianId, musicianName }: {
  entry: GigEntry; date: Date; isOwn: boolean; musicianId: string; musicianName: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const type = entry.type || 'gig';

  const leftBorderColor = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const badgeLabel      = type === 'gig' ? 'Booked' : type === 'away' ? 'Away' : 'Free';
  const badgeColor      = type === 'gig' ? '#16a34a' : type === 'away' ? '#888888' : Colors.orange;
  const badgeBorderCol  = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const dayAbbrev = date.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();

  return (
    <View style={[mt.entryRow, { borderColor: colors.border, borderLeftColor: leftBorderColor, backgroundColor: colors.bg }]}>
      <View style={mt.dateBox}>
        <Text style={[mt.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[mt.dateMonth, { color: colors.grey }]}>{SHORT_MO[date.getMonth()].toUpperCase()}</Text>
      </View>
      <Text style={[mt.dayAbbrev, { color: colors.grey }]}>{dayAbbrev}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[mt.entryMain, { color: colors.black }]} numberOfLines={1}>
          {type === 'gig' ? (entry.venue || 'Gig') : type === 'away' ? (entry.notes || 'Away') : (entry.notes || 'Available')}
        </Text>
        {type === 'gig' && entry.suburb
          ? <Text style={[mt.entrySub, { color: colors.grey }]}>{entry.suburb}</Text>
          : null}
        {type === 'away' && entry.endDate
          ? <Text style={[mt.entrySub, { color: colors.grey }]}>Until {new Date(entry.endDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</Text>
          : null}
      </View>
      <View style={[mt.statusBadge, { borderColor: badgeBorderCol }]}>
        <Text style={[mt.statusBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
      {type === 'gig' && (entry.socialPostUrl || entry.ticketUrl) ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {entry.socialPostUrl ? (
            <TouchableOpacity
              style={[mt.linkBtn, { borderColor: colors.border }]}
              onPress={() => { const u = entry.socialPostUrl!; if (u.startsWith('http')) Linking.openURL(u); }}
            >
              <Text style={[mt.linkBtnText, { color: colors.black }]}>Post →</Text>
            </TouchableOpacity>
          ) : null}
          {entry.ticketUrl ? (
            <TouchableOpacity
              style={mt.ticketBtn}
              onPress={() => { const u = entry.ticketUrl!; if (u.startsWith('http')) Linking.openURL(u); }}
            >
              <Text style={mt.ticketBtnText}>Tickets →</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {type === 'free' && !isOwn ? (
        <TouchableOpacity
          style={mt.messageBtn}
          onPress={() => router.push({ pathname: '/messages/[id]', params: { id: musicianId, name: musicianName } } as any)}
        >
          <Text style={mt.messageBtnText}>Message →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function NativeMusEntryCard({ entry, date, isOwn, musicianId, musicianName }: {
  entry: GigEntry; date: Date; isOwn: boolean; musicianId: string; musicianName: string;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const type = entry.type || 'gig';
  const borderColor = type === 'gig' ? '#22c55e' : type === 'away' ? '#e0e0e0' : Colors.orange;
  const badgeLabel  = type === 'gig' ? 'Booked' : type === 'away' ? 'Away' : 'Free';
  const badgeColor  = type === 'gig' ? '#16a34a' : type === 'away' ? '#888888' : Colors.orange;

  return (
    <View style={[nmt.card, { borderColor, backgroundColor: colors.bg }]}>
      <View style={nmt.dateBox}>
        <Text style={[nmt.dateNum, { color: colors.black }]}>{date.getDate()}</Text>
        <Text style={[nmt.dateMonth, { color: colors.grey }]}>{SHORT_MO[date.getMonth()].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[nmt.main, { color: colors.black }]} numberOfLines={1}>
          {type === 'gig' ? (entry.venue || 'Gig') : type === 'away' ? 'Away' : 'Available'}
        </Text>
        {type === 'gig' && entry.suburb
          ? <Text style={[nmt.sub, { color: colors.grey }]}>{entry.suburb}</Text>
          : null}
        {type === 'away' && entry.endDate
          ? <Text style={[nmt.sub, { color: colors.grey }]}>Until {new Date(entry.endDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</Text>
          : null}
        {entry.notes ? <Text style={[nmt.notes, { color: colors.grey }]}>{entry.notes}</Text> : null}
        {type === 'gig' && (entry.socialPostUrl || entry.ticketUrl) ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {entry.socialPostUrl ? (
              <TouchableOpacity onPress={() => { const u = entry.socialPostUrl!; if (u.startsWith('http')) Linking.openURL(u); }}>
                <Text style={nmt.linkText}>Social post →</Text>
              </TouchableOpacity>
            ) : null}
            {entry.ticketUrl ? (
              <TouchableOpacity onPress={() => { const u = entry.ticketUrl!; if (u.startsWith('http')) Linking.openURL(u); }}>
                <Text style={[nmt.linkText, { fontWeight: '700' }]}>Tickets →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {type === 'free' && !isOwn ? (
          <TouchableOpacity
            style={nmt.msgBtn}
            onPress={() => router.push({ pathname: '/messages/[id]', params: { id: musicianId, name: musicianName } } as any)}
          >
            <Text style={nmt.msgBtnText}>Message →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[nmt.badge, { borderColor }]}>
        <Text style={[nmt.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
    </View>
  );
}

// ── Timetable Tab ─────────────────────────────────────────────────

function TimetableTab({ m, isOwn, isMobileLayout, publicGigs = [], awayPeriods = [] }: { m: Musician; isOwn: boolean; isMobileLayout: boolean; publicGigs?: any[]; awayPeriods?: any[] }) {
  const { colors } = useTheme();
  const router = useRouter();
  const today = new Date();
  const [filterTab, setFilterTab]   = useState<'all' | 'gigs' | 'away'>('all');
  const [monthOffset, setMonthOffset] = useState(0);

  const gigEntries: EntryItem[] = publicGigs
    // publicGigs projections never carry a status field (they only ever exist
    // while confirmed); raw gigs docs (owner's own view) do, so check it there.
    .filter(pg => !!pg.startAt && pg.venueName && (pg.status == null || pg.status === 'confirmed'))
    .map(pg => {
      const d = pg.startAt.toDate();
      const entry: GigEntry = {
        venue: pg.venueName ?? undefined,
        suburb: pg.locationText ?? undefined,
        date: isoDate(d),
        ticketUrl: pg.ticketUrl ?? undefined,
        notes: pg.description ?? undefined,
        type: 'gig',
      };
      return { date: d, dateISO: isoDate(d), entry };
    });

  const awayEntries: EntryItem[] = awayPeriods.map((p: any) => {
    const d = new Date(p.from + 'T00:00:00');
    const entry: GigEntry = { date: p.from, type: 'away', endDate: p.to ?? undefined, notes: p.notes ?? undefined };
    return { date: d, dateISO: p.from, entry };
  });

  const allEntries: EntryItem[] = [...gigEntries, ...awayEntries]
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const windowStart = new Date(today);
  windowStart.setMonth(windowStart.getMonth() + monthOffset);
  windowStart.setHours(0,0,0,0);
  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 3);
  windowEnd.setHours(23,59,59,999);

  const windowEntries = allEntries.filter(({ date }) => date >= windowStart && date <= windowEnd);
  const filtered = windowEntries.filter(({ entry }) => {
    const t = entry.type || 'gig';
    if (filterTab === 'gigs') return t === 'gig';
    if (filterTab === 'away') return t === 'away';
    return true;
  });
  const monthGroups = groupByMonth(filtered);

  const countLabel = filterTab === 'gigs'
    ? `${filtered.length} gig${filtered.length !== 1 ? 's' : ''}`
    : filterTab === 'away'
      ? `${filtered.length} away date${filtered.length !== 1 ? 's' : ''}`
      : `${filtered.length} entr${filtered.length !== 1 ? 'ies' : 'y'}`;

  const rangeLabel = `(${LONG_MO[windowStart.getMonth()]} – ${LONG_MO[windowEnd.getMonth()]} ${windowEnd.getFullYear()})`;
  const musicianId   = m.id;
  const musicianName = m.name || 'Musician';

  if (!isMobileLayout) {
    return (
      <View style={mt.tabBody}>
        {/* Filter row */}
        <View style={mt.filterRow}>
          <View style={[mt.filterTabs, { borderColor: colors.border }]}>
            {(['all', 'gigs', 'away'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[mt.filterTab, filterTab === tab && mt.filterTabActive]}
                onPress={() => setFilterTab(tab)}
              >
                <Text style={[mt.filterTabText, { color: filterTab === tab ? '#111111' : colors.grey }]}>
                  {tab === 'all' ? 'All' : tab === 'gigs' ? 'Gigs' : 'Away'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={mt.countRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[mt.countLabel, { color: colors.grey }]}>{countLabel}</Text>
              <Text style={[mt.countLabel, { color: colors.grey, fontWeight: '400' }]}>{rangeLabel}</Text>
            </View>
            <View style={mt.monthNavRow}>
              {monthOffset > 0 && (
                <TouchableOpacity style={mt.monthNavBtn} onPress={() => setMonthOffset(o => o - 3)}>
                  <Text style={[mt.monthNavText, { color: colors.grey }]}>&larr; Previous 3 Months</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={mt.monthNavBtn} onPress={() => setMonthOffset(o => o + 3)}>
                <Text style={[mt.monthNavText, { color: colors.grey }]}>Next 3 Months &rarr;</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Body: calendar + list */}
        <View style={mt.body}>
          {/* Calendar panel */}
          <View style={[mt.calPanel, { borderColor: colors.border }]}>
            <Text style={[mt.calPanelTitle, { color: colors.grey }]}>AVAILABILITY AT A GLANCE</Text>
            <View style={mt.calLegend}>
              <View style={mt.calLegendItem}>
                <View style={[mt.calDot, { backgroundColor: '#22c55e' }]} />
                <Text style={[mt.calLegendText, { color: colors.grey }]}>Booked</Text>
              </View>
              <View style={mt.calLegendItem}>
                <Text style={[mt.calLegendText, { color: colors.greyLight, textDecorationLine: 'line-through', fontWeight: '700', fontSize: 13, marginRight: 2 }]}>15</Text>
                <Text style={[mt.calLegendText, { color: colors.grey }]}>Away</Text>
              </View>
            </View>
            {(() => {
              const calMonths: { year: number; month: number }[] = [];
              const cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
              const end = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
              while (cur <= end) {
                calMonths.push({ year: cur.getFullYear(), month: cur.getMonth() });
                cur.setMonth(cur.getMonth() + 1);
              }
              return calMonths.map(({ year, month }) => (
                <MusicianCalendarMonth
                  key={`${year}-${month}`}
                  entries={allEntries.map(e => e.entry)}
                  month={month} year={year} today={today}
                  windowStart={windowStart} windowEnd={windowEnd}
                  colors={colors}
                />
              ));
            })()}
          </View>

          {/* List area */}
          <View style={mt.listArea}>
            {monthGroups.length === 0 ? (
              allEntries.length === 0 && isOwn ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={[mt.emptyText, { color: colors.grey }]}>No schedule yet.</Text>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/gigs' as any)} activeOpacity={0.75}>
                    <Text style={{ color: Colors.orange, fontSize: 13, fontWeight: '700' }}>Add +</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[mt.emptyText, { color: colors.grey }]}>
                  {allEntries.length === 0 ? 'No schedule listed yet.' : 'Nothing to show for this period.'}
                </Text>
              )
            ) : (
              monthGroups.map(group => {
                return (
                  <View key={`${group.year}-${group.month}`} style={mt.monthGroup}>
                    <View style={mt.monthHeader}>
                      <Text style={[mt.monthLabel, { color: colors.black }]}>
                        {LONG_MO[group.month].toUpperCase()} {group.year}
                      </Text>
                    </View>
                    {group.items.map(({ date, dateISO, entry }, i) => (
                      <MusEntryRow
                        key={`${dateISO}-${i}`}
                        entry={entry} date={date}
                        isOwn={isOwn} musicianId={musicianId} musicianName={musicianName}
                      />
                    ))}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </View>
    );
  }

  // ── Native ──
  return (
    <View>
      <View style={nmt.filterRow}>
        <View style={[nmt.filterControl, { borderColor: colors.border }]}>
          {(['all', 'gigs', 'away'] as const).map((tab, i, arr) => (
            <TouchableOpacity
              key={tab}
              style={[
                nmt.filterBtn,
                filterTab === tab && nmt.filterBtnActive,
                i < arr.length - 1 && { borderRightWidth: 1, borderRightColor: colors.border },
              ]}
              onPress={() => setFilterTab(tab)}
            >
              <Text style={[nmt.filterText, { color: filterTab === tab ? '#111111' : colors.grey }]}>
                {tab === 'all' ? 'All' : tab === 'gigs' ? 'Gigs' : 'Away'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[nmt.legend, { marginTop: 10 }]}>
          <View style={nmt.legendItem}>
            <View style={[nmt.legendDot, { backgroundColor: '#22c55e' }]} />
            <Text style={[nmt.legendText, { color: colors.grey }]}>Booked</Text>
          </View>
          <View style={nmt.legendItem}>
            <Text style={[nmt.legendText, { color: colors.greyLight, textDecorationLine: 'line-through', fontWeight: '700', marginRight: 2 }]}>15</Text>
            <Text style={[nmt.legendText, { color: colors.grey }]}>Away</Text>
          </View>
        </View>
      </View>
      <View style={nmt.countNav}>
        <View style={{ gap: 4 }}>
          <View style={nmt.countRow}>
            <Text style={[nmt.countLabel, { color: colors.grey }]}>{countLabel}</Text>
            <Text style={[nmt.dateRange, { color: colors.grey }]}>{rangeLabel}</Text>
          </View>
          <View style={[nmt.navBtns, { justifyContent: 'flex-end' }]}>
            {monthOffset > 0 && (
              <TouchableOpacity style={nmt.navBtn} onPress={() => setMonthOffset(o => o - 3)}>
                <Text style={[nmt.navBtnText, { color: colors.grey }]}>← Prev 3 months</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={nmt.navBtn} onPress={() => setMonthOffset(o => o + 3)}>
              <Text style={[nmt.navBtnText, { color: colors.grey }]}>Next 3 months →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {monthGroups.length === 0 ? (
        allEntries.length === 0 && isOwn ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={[nmt.emptyText, { color: colors.grey }]}>No schedule yet.</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/gigs' as any)} activeOpacity={0.75}>
              <Text style={{ color: Colors.orange, fontSize: 13, fontWeight: '700' }}>Add +</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[nmt.emptyText, { color: colors.grey }]}>
            {allEntries.length === 0 ? 'No schedule listed yet.' : 'Nothing to show for this period.'}
          </Text>
        )
      ) : (
        monthGroups.map(group => (
          <View key={`${group.year}-${group.month}`} style={nmt.monthGroup}>
            <Text style={[nmt.monthLabel, { color: colors.grey }]}>
              {LONG_MO[group.month].toUpperCase()} {group.year}
            </Text>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {group.items.map(({ date, dateISO, entry }, i) => (
                <NativeMusEntryCard
                  key={`${dateISO}-${i}`}
                  entry={entry} date={date}
                  isOwn={isOwn} musicianId={musicianId} musicianName={musicianName}
                />
              ))}
            </View>
          </View>
        ))
      )}
      <View style={{ height: 20 }} />
    </View>
  );
}

// ── Pending Agent Claims (shown on own profile) ───────────────────

type ClaimForMusician = {
  id: string;
  agentUid: string;
  agentName: string;
  agentUsername?: string;
  verificationCode: string;
  status: string;
};

function PendingAgentClaims({ musicianId }: { musicianId: string }) {
  const { colors } = useTheme();
  const [claims, setClaims]           = useState<ClaimForMusician[]>([]);
  const [loading, setLoading]         = useState(true);
  const [processing, setProcessing]   = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed]     = useState<Set<string>>(new Set());

  useEffect(() => {
    getDocs(
      query(collection(db, 'agentClaims'),
        where('artistUid', '==', musicianId),
        where('status', '==', 'pending'))
    ).then(snap => {
      setClaims(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClaimForMusician)));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [musicianId]);

  async function handleDecline(claim: ClaimForMusician) {
    setProcessing(p => ({ ...p, [claim.id]: true }));
    try {
      await updateDoc(doc(db, 'agentClaims', claim.id), {
        status: 'declined',
        respondedAt: new Date().toISOString(),
      });
      setClaims(prev => prev.filter(c => c.id !== claim.id));
    } catch {} finally {
      setProcessing(p => ({ ...p, [claim.id]: false }));
    }
  }

  const visible = claims.filter(c => !dismissed.has(c.id));
  if (loading || visible.length === 0) return null;

  return (
    <View style={[pac.wrap, { borderColor: colors.border }]}>
      <Text style={[pac.heading, { color: colors.black }]}>Representation Requests</Text>
      {visible.map(claim => (
        <View key={claim.id} style={[pac.card, { borderColor: colors.border, backgroundColor: colors.bgFaint }]}>
          <View style={pac.cardTop}>
            <View style={pac.agentInfo}>
              <Text style={[pac.agentName, { color: colors.black }]}>{claim.agentName}</Text>
              {claim.agentUsername
                ? <Text style={[pac.agentHandle, { color: colors.grey }]}>@{claim.agentUsername}</Text>
                : null}
            </View>
            <View style={[pac.badge, { borderColor: '#f5a623' }]}>
              <Text style={[pac.badgeText, { color: '#f5a623' }]}>Pending</Text>
            </View>
          </View>
          <Text style={[pac.bodyText, { color: colors.grey }]}>
            This agent wants to represent you on Twaylo. Share the code below with them to approve, or decline if you don't recognise this request.
          </Text>
          <View style={[pac.codeDisplay, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[pac.codeDisplayLabel, { color: colors.grey }]}>YOUR VERIFICATION CODE</Text>
            <Text style={[pac.codeDisplayValue, { color: colors.black }]}>{claim.verificationCode}</Text>
          </View>
          <View style={pac.actions}>
            <TouchableOpacity
              style={[pac.declineBtn, { borderColor: colors.border }, processing[claim.id] && pac.btnDim]}
              onPress={() => handleDecline(claim)}
              disabled={!!processing[claim.id]}
              activeOpacity={0.75}
            >
              {processing[claim.id]
                ? <ActivityIndicator color={colors.grey} size="small" />
                : <Text style={[pac.declineBtnText, { color: colors.grey }]}>Decline</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const pac = StyleSheet.create({
  wrap: {
    borderTopWidth: 1, borderBottomWidth: 1,
    paddingHorizontal: isWeb ? 40 : 20, paddingVertical: 20,
    marginBottom: 4,
  },
  heading:    { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, color: Colors.orange, marginBottom: 12, textTransform: 'uppercase' },
  card:       { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10, gap: 10 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  agentInfo:  {},
  agentName:  { fontSize: 15, fontWeight: '700' },
  agentHandle:{ fontSize: 12, marginTop: 2 },
  badge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:  { fontSize: 12, fontWeight: '700' },
  bodyText:   { fontSize: 13, lineHeight: 20 },
  codeInput:  {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 20, fontWeight: '700', letterSpacing: 6, textAlign: 'center',
    width: 160,
  },
  codeDisplay:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', gap: 4 },
  codeDisplayLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  codeDisplayValue: { fontSize: 28, fontWeight: '800', letterSpacing: 8 },
  codeError:  { fontSize: 12, color: Colors.danger },
  actions:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: { flex: 1, backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  btnDim:     { opacity: 0.45 },
  approveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  declineBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: 'center' },
  declineBtnText: { fontSize: 14, fontWeight: '600' },
});

// ── Main Screen ───────────────────────────────────────────────────

export default function MusicianScreen({ _overrideId }: { _overrideId?: string } = {}) {
  const { id: paramId, tab: initialTab, preview } = useLocalSearchParams<{ id: string; tab?: string; preview?: string }>();
  const id             = _overrideId ?? String(paramId);
  const isProfileTab   = !!_overrideId;
  const isPublicPreview = !!preview;
  const router       = useRouter();
  const { user }     = useAuth();
  const { colors }   = useTheme();
  const year         = new Date().getFullYear();
  const now          = new Date();

  const handleBack = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/musicians');

  const [musician, setMusician]   = useState<Musician | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'music' | 'timetable' | 'gigs' | 'dashboard'>(
    initialTab === 'music' ? 'music' : initialTab === 'timetable' ? 'timetable' : initialTab === 'gigs' ? 'gigs' : initialTab === 'dashboard' ? 'dashboard' : 'overview'
  );
  const [publicGigs, setPublicGigs]         = useState<any[]>([]);
  const [ownGigs, setOwnGigs]               = useState<any[]>([]);

  const isOwn = !isPublicPreview && user?.uid === id;
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;

  useEffect(() => {
    getDoc(doc(db, 'bandProfiles', id)).then(snap => {
      if (snap.exists()) setMusician({ id: snap.id, ...snap.data() } as Musician);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    getDocs(query(
      collection(db, 'publicGigs'),
      where('artistUid', '==', id),
      orderBy('startAt', 'asc'),
    )).then(snap => {
      setPublicGigs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, [id]);

  // Owner's own gigs, any source or visibility (private Twaylo bookings
  // included). Used instead of publicGigs for Overview and Timetable when
  // isOwn (never in public preview, since isOwn is forced false there), so a
  // real third party, and a preview of one, only ever see publicGigs, the
  // properly isPublic-gated projection.
  useEffect(() => {
    if (!isOwn) return;
    getDocs(query(collection(db, 'gigs'), where('participantIds', 'array-contains', id)))
      .then(snap => setOwnGigs(snap.docs.map(d => d.data())))
      .catch(() => {});
  }, [isOwn, id]);

  const gigsForTabs = isOwn ? ownGigs : publicGigs;

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

  // gigsPlayed/averageDraw are server-computed aggregates (a Cloud Function
  // trigger on the gigs collection) from every one of the artist's confirmed
  // gigs, regardless of that gig's own public-profile toggle: these are
  // credibility numbers, same as fee range, not per-gig details.
  const completedGigs   = musician.gigsPlayed ?? 0;
  const liveAverageDraw = musician.averageDraw ?? null;

  const typicalFeeText = musician.payment?.typicalFee?.trim() || null;
  const feeStr = typicalFeeText
    ? typicalFeeText
    : (musician.feeMin != null || musician.feeMax != null)
      ? (musician.feeMin != null && musician.feeMax != null
          ? `$${musician.feeMin.toLocaleString()} – $${musician.feeMax.toLocaleString()}`
          : musician.feeMin != null
            ? `From $${musician.feeMin.toLocaleString()}`
            : `Up to $${musician.feeMax!.toLocaleString()}`)
      : null;

  const statsItems = [
    musician.memberCount              ? { value: musician.memberCount,                        label: 'LINEUP'           } : null,
    completedGigs > 0                 ? { value: String(completedGigs),                       label: 'GIGS PLAYED'      } : null,
    liveAverageDraw != null           ? { value: `~${liveAverageDraw}`,                        label: 'AVG DRAW'         } : null,
    feeStr                            ? { value: feeStr,                                      label: 'FEE'              } : null,
    musician.setType                  ? { value: musician.setType,                            label: 'SET TYPE'         } : null,
    musician.ageRestriction           ? { value: musician.ageRestriction,                     label: 'SUITABILITY'      } : null,
    musician.payment?.publicLiabilityHeld ? { value: 'Insured',                               label: 'PUBLIC LIABILITY' } : null,
    musician.actSize                  ? { value: musician.actSize,                            label: 'ACT SIZE'         } : null,
    musician.backline                 ? { value: musician.backline,                           label: 'BACKLINE'         } : null,
  ].filter(Boolean) as { value: string; label: string }[];

  // ── Web desktop dashboard (own profile only) ──────────────────────
  if (isProfileTab && !isMobileLayout) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['bottom']}>
        <View style={dash.container}>

          {/* Left sidebar */}
          <View style={[dash.sidebar, { backgroundColor: colors.bgFaint, borderRightColor: colors.border }]}>
            {musician.photoUrl ? (
              <Image source={{ uri: musician.photoUrl }} style={dash.photo} resizeMode="cover" />
            ) : (
              <View style={[dash.photoPlaceholder, { backgroundColor: colors.border }]} />
            )}
            <Text style={[dash.sidebarName, { color: colors.black }]} numberOfLines={2}>
              {musician.name || 'Unnamed Act'}
            </Text>
            {musician.username ? (
              <Text style={[dash.sidebarHandle, { color: colors.grey }]}>@{musician.username}</Text>
            ) : null}
            {breadcrumbParts.length > 0 ? (
              <Text style={dash.sidebarMeta} numberOfLines={2}>
                {breadcrumbParts.join(' · ')}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[dash.viewPublicBtn, { borderColor: colors.border }]}
              onPress={() => router.push(`/musician/${id}?preview=1` as any)}
              activeOpacity={0.8}
            >
              <Text style={[dash.viewPublicText, { color: colors.black }]}>View public profile</Text>
            </TouchableOpacity>

            <View style={{ height: 12 }} />

            {([
              { id: 'overview',   label: 'Overview'       },
              { id: 'music',      label: 'Music & Social' },
              { id: 'timetable',  label: 'Timetable'      },
            ] as const).map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={[dash.navItem, activeTab === tab.id && dash.navItemActive]}
                onPress={() => setActiveTab(tab.id)}
                activeOpacity={0.75}
              >
                <Text style={[dash.navText, { color: activeTab === tab.id ? Colors.orange : colors.black }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}

            {isOwn && (
              <>
                <View style={[dash.divider, { backgroundColor: colors.border }]} />
                {([
                  { id: 'gigs',      label: 'My Gigs'   },
                  { id: 'dashboard', label: 'Dashboard'  },
                ] as const).map(tab => (
                  <TouchableOpacity
                    key={tab.id}
                    style={[dash.navItem, activeTab === tab.id && dash.navItemActive]}
                    onPress={() => setActiveTab(tab.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={[dash.navText, { color: activeTab === tab.id ? Colors.orange : colors.black }]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <View style={[dash.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={dash.editBtn}
              onPress={() => router.push('/edit-profile')}
              activeOpacity={0.85}
            >
              <Text style={dash.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dash.logoutBtn, { borderColor: colors.border }]}
              onPress={async () => { await signOut(auth); router.replace('/'); }}
              activeOpacity={0.75}
            >
              <Text style={[dash.logoutText, { color: colors.grey }]}>Log out</Text>
            </TouchableOpacity>
          </View>

          {/* Main content */}
          <ScrollView style={dash.main} contentContainerStyle={dash.mainContent}>
            {isOwn && <PendingAgentClaims musicianId={id} />}
            {activeTab === 'overview'   && <OverviewTab m={musician} isMobileLayout={false} publicGigs={gigsForTabs} isOwn={isOwn} />}
            {activeTab === 'music'      && <MusicTab m={musician} isOwn={isOwn} />}
            {activeTab === 'timetable'  && <TimetableTab m={musician} isOwn={isOwn} isMobileLayout={false} publicGigs={gigsForTabs} awayPeriods={(musician as any).awayPeriods ?? []} />}
            {activeTab === 'gigs'       && isOwn && <MyGigsContent embedded />}
            {activeTab === 'dashboard'  && isOwn && <DashboardContent />}
            <View style={{ height: 40 }} />
          </ScrollView>

        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges ?? ['bottom']}>
      {isPublicPreview && (
        <View style={[styles.previewBanner, { backgroundColor: colors.black }]}>
          <Text style={styles.previewBannerText}>Previewing as the public would see this profile</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/profile' as any)} activeOpacity={0.75}>
            <Text style={styles.previewBannerExit}>Exit preview</Text>
          </TouchableOpacity>
        </View>
      )}
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
          <View style={[styles.nameRow, isMobileLayout && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <Text style={[styles.name, { color: colors.black, flex: isMobileLayout ? undefined : 1 }]} numberOfLines={2}>
              {musician.name || 'Unnamed Act'}
            </Text>
            {isOwn && (
              <View style={[styles.ownerBtns, isMobileLayout && { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={() => router.push('/(tabs)/gigs' as any)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.black }]}>My Gigs</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={() => router.push('/edit-profile')}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.black }]}>Edit profile</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: colors.border }]}
                  onPress={async () => { await signOut(auth); router.replace('/'); }}
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

        {/* Pending agent claim requests (own profile only) */}
        {isOwn && <PendingAgentClaims musicianId={id} />}

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
            { id: 'overview',   label: 'Overview'       },
            { id: 'music',      label: 'Music & Social' },
            { id: 'timetable',  label: 'Timetable'      },
            ...(isOwn ? [{ id: 'dashboard', label: 'Dashboard' }] : []),
          ] as const).map((tab: { id: string; label: string }) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id as any)}
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
        {activeTab === 'overview'   && <OverviewTab m={musician} isMobileLayout={isMobileLayout} publicGigs={gigsForTabs} isOwn={isOwn} />}
        {activeTab === 'music'      && <MusicTab m={musician} isOwn={isOwn} />}
        {activeTab === 'timetable'  && <TimetableTab m={musician} isOwn={isOwn} isMobileLayout={isMobileLayout} publicGigs={gigsForTabs} awayPeriods={(musician as any).awayPeriods ?? []} />}
        {activeTab === 'gigs'       && isOwn && <MyGigsContent embedded />}
        {activeTab === 'dashboard'  && isOwn && <DashboardContent />}

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
  previewBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 16 },
  previewBannerText: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  previewBannerExit: { fontSize: 12, fontWeight: '700', color: Colors.orange },
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
    paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, gap: 28,
  },
  overviewMain:    { flex: 1, paddingBottom: 28 },
  overviewSidebar: { width: 310, gap: 0 },
  mobileSidebar:   { gap: 0 },
  mobileContent:   { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 24, paddingBottom: 4 },
  tabContent:      { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 16,
  },
  managedBy: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 16 },
  body:      { fontSize: 15, lineHeight: 22 },
  readMore:  { fontSize: 14, color: Colors.orange, fontWeight: '600', marginTop: 8 },
  emptyState:{ fontSize: 14, fontStyle: 'italic' },

  // Sidebar cards
  sideCard: {
    borderWidth: 1, borderRadius: 12,
    padding: 16, marginBottom: 12,
  },
  sideSectionLabel: {
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 10,
  },
  sideFee:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  sideLink: { fontSize: 14, color: Colors.orange, fontWeight: '500', marginBottom: 6 },
  sideBody: { fontSize: 14, lineHeight: 20 },

  // Gigs summary (Overview): plain lines grouped by Upcoming/Past/Away
  gigGroup:      { marginBottom: 12 },
  gigGroupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 6 },
  gigLine:       { fontSize: 14, lineHeight: 20, marginBottom: 3 },

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

// ── Musician timetable styles (web) ──────────────────────────────
const mt = StyleSheet.create({
  tabBody:       { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28, paddingBottom: 40 },
  filterRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  filterTabs:    { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  filterTab:     { paddingHorizontal: 18, paddingVertical: 9 },
  filterTabActive: { backgroundColor: Colors.orange },
  filterTabText: { fontSize: 13, fontWeight: '600' },
  countRow:      { gap: 8 },
  countLabel:    { fontSize: 13, fontWeight: '500' },
  monthNavRow:   { flexDirection: 'row', gap: 10 },
  monthNavBtn:   { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#e0e0e0' },
  monthNavText:  { fontSize: 13, fontWeight: '600' },
  body:          { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  // Calendar panel
  calPanel:      { width: 210, borderWidth: 1, borderRadius: 12, padding: 16 },
  calPanelTitle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  calLegend:     { gap: 6, marginBottom: 20 },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calLegendText: { fontSize: 11 },
  calDot:        { width: 8, height: 8, borderRadius: 4 },
  calMonth:      { marginBottom: 18 },
  calMonthLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  calDowRow:     { flexDirection: 'row', marginBottom: 2 },
  calDow:        { flex: 1, textAlign: 'center' as const, fontSize: 9, fontWeight: '700' },
  calGrid:       { flexDirection: 'row', flexWrap: 'wrap' },
  calCell:       { width: '14.28%' as any, alignItems: 'center', paddingVertical: 2 },
  calDayCircle:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calDayCircleToday: { backgroundColor: Colors.orange },
  calDayNum:     { fontSize: 10, fontWeight: '600' },
  calDots:       { flexDirection: 'row', gap: 1, minHeight: 6, marginTop: 1, justifyContent: 'center' },
  // List area
  listArea:      { flex: 1 },
  emptyText:     { fontSize: 15, paddingVertical: 40, textAlign: 'center' as const },
  monthGroup:    { marginBottom: 24 },
  monthHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  monthLabel:    { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  monthFreeCount:{ fontSize: 11, color: Colors.orange, fontWeight: '600' },
  // Entry row
  entryRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderLeftWidth: 4, borderRadius: 8, marginBottom: 8, paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  dateBox:       { width: 36, alignItems: 'center', flexShrink: 0 },
  dateNum:       { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  dateMonth:     { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  dayAbbrev:     { width: 28, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.5, flexShrink: 0 },
  entryMain:     { fontSize: 15, fontWeight: '700' },
  entrySub:      { fontSize: 13, marginTop: 2 },
  statusBadge:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0 },
  statusBadgeText: { fontSize: 12, fontWeight: '600' },
  linkBtn:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  linkBtnText:   { fontSize: 12, fontWeight: '600' },
  ticketBtn:     { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, flexShrink: 0 },
  ticketBtnText: { fontSize: 12, fontWeight: '700', color: '#111111' },
  messageBtn:    { backgroundColor: Colors.orange, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, flexShrink: 0 },
  messageBtnText:{ fontSize: 13, fontWeight: '700', color: '#111111' },
});

// ── Musician timetable styles (native) ───────────────────────────
const nmt = StyleSheet.create({
  filterRow:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  filterControl: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  filterBtn:     { paddingHorizontal: 16, paddingVertical: 10 },
  filterBtnActive: { backgroundColor: Colors.orange },
  filterText:    { fontSize: 13, fontWeight: '700' },
  countNav:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8 },
  countRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 4 },
  countLabel:    { fontSize: 13, fontWeight: '500' },
  dateRange:     { fontSize: 12, fontWeight: '400' },
  navBtns:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  navBtn:        { paddingVertical: 6, alignSelf: 'flex-start' as const },
  navBtnText:    { fontSize: 13, fontWeight: '600' },
  legend:        { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 4 },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:     { width: 9, height: 9, borderRadius: 5 },
  legendText:    { fontSize: 12 },
  emptyText:     { textAlign: 'center' as const, fontSize: 14, fontStyle: 'italic', paddingVertical: 32, paddingHorizontal: 20 },
  monthGroup:    { marginBottom: 20 },
  monthLabel:    { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 16, paddingBottom: 10, paddingTop: 14, textTransform: 'uppercase' as const },
  // Native entry card
  card:          { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 14, gap: 12 },
  dateBox:       { width: 36, alignItems: 'center', flexShrink: 0, paddingTop: 2 },
  dateNum:       { fontSize: 18, fontWeight: '800', lineHeight: 20 },
  dateMonth:     { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  main:          { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  sub:           { fontSize: 13, marginBottom: 2 },
  notes:         { fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  linkText:      { fontSize: 13, color: Colors.orange, fontWeight: '600', marginRight: 4 },
  msgBtn:        { marginTop: 10, backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start' as const },
  msgBtnText:    { fontSize: 13, fontWeight: '700', color: '#111111' },
  badge:         { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0, alignSelf: 'flex-start', marginTop: 2 },
  badgeText:     { fontSize: 11, fontWeight: '600' },
});

// ── Dashboard styles (web desktop, own profile) ────────────────────
const dash = StyleSheet.create({
  container:        { flex: 1, flexDirection: 'row' },
  sidebar:          { width: 224, borderRightWidth: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  photo:            { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  photoPlaceholder: { width: 72, height: 72, borderRadius: 8, marginBottom: 14 },
  sidebarName:      { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22, marginBottom: 3 },
  sidebarHandle:    { fontSize: 12, marginBottom: 6 },
  sidebarMeta:      { fontSize: 11, fontWeight: '700', color: Colors.orange, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16 },
  viewPublicBtn:    { borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  viewPublicText:   { fontSize: 13, fontWeight: '600' },
  divider:          { height: 1, marginVertical: 18 },
  navItem:          { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 7, marginBottom: 2 },
  navItemActive:    { backgroundColor: Colors.orange + '18' },
  navText:          { fontSize: 14, fontWeight: '600' },
  editBtn:          { backgroundColor: Colors.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginBottom: 8 },
  editBtnText:      { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  logoutBtn:        { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  logoutText:       { fontSize: 13, fontWeight: '600' },
  main:             { flex: 1 },
  mainContent:      { paddingHorizontal: 40, paddingVertical: 32 },
});
