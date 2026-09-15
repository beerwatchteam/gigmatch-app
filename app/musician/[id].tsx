import { useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Linking, Platform, useWindowDimensions,
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
type GigEntry   = { venue?: string; suburb?: string; date?: string; attendance?: number; notes?: string; socialPostUrl?: string; ticketUrl?: string };

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
  techRider?: {
    monitoring?: string;
    backlineNeeded?: string;
    stageSize?: string;
    soundcheck?: string;
    notes?: string;
  };
  techRiderDocs?: { url: string; name: string }[];
};

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ m, isMobileLayout }: { m: Musician; isMobileLayout: boolean }) {
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
  const hasTechRider   = !!(m.techRider && Object.values(m.techRider).some(v => v));
  const hasTechDocs    = !!(m.techRiderDocs && m.techRiderDocs.length > 0);
  const hasSidebar     = hasContact || hasSocials || !!m.availability || hasTechRider || hasTechDocs;


  const sidebar = (
    <View style={!isMobileLayout ? styles.overviewSidebar : styles.mobileSidebar}>
      {hasContact && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.black }]}>Contact</Text>
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
          <Text style={[styles.sideSectionLabel, { color: colors.black }]}>Socials</Text>
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
          <Text style={[styles.sideSectionLabel, { color: colors.black }]}>Availability</Text>
          <Text style={[styles.sideBody, { color: colors.black }]}>{m.availability}</Text>
        </View>
      )}
      {(hasTechRider || hasTechDocs) && (
        <View style={[styles.sideCard, { borderColor: colors.border }]}>
          <Text style={[styles.sideSectionLabel, { color: colors.black }]}>Tech Rider</Text>
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
      {about ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.black }]}>About</Text>
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
          <Text style={[styles.sectionLabel, { color: colors.black }]}>Past Gigs</Text>
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

  if (isMobileLayout) {
    return (
      <>
        <View style={styles.mobileContent}>{main}</View>
        {hasSidebar && <View style={styles.mobileContent}>{sidebar}</View>}
      </>
    );
  }

  return (
    <View style={styles.overviewLayout}>
      {main}
      {hasSidebar && <View>{sidebar}</View>}
    </View>
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

// ── Timetable helpers ──────────────────────────────────────────────

const SHORT_MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MO  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
    if (e.date) { const a = byDate.get(e.date) || []; a.push(e); byDate.set(e.date, a); }
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
          const hasFree = dayEntries.some(e => (e.type || 'gig') === 'free');
          const hasGig  = dayEntries.some(e => (e.type || 'gig') === 'gig');
          const hasAway = dayEntries.some(e => (e.type || 'gig') === 'away');
          return (
            <View key={`${year}-${month}-${dayNum}`} style={mt.calCell}>
              <View style={[mt.calDayCircle, isToday && mt.calDayCircleToday]}>
                <Text style={[mt.calDayNum, { color: isToday ? '#ffffff' : outOfRange ? colors.greyLight : colors.black }]}>{dayNum}</Text>
              </View>
              <View style={mt.calDots}>
                {!outOfRange && hasFree && <View style={[mt.calDot, { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.orange }]} />}
                {!outOfRange && hasGig  && <View style={[mt.calDot, { backgroundColor: '#22c55e' }]} />}
                {!outOfRange && hasAway && <View style={[mt.calDot, { backgroundColor: '#e0e0e0' }]} />}
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

function TimetableTab({ m, isOwn }: { m: Musician; isOwn: boolean }) {
  const { colors } = useTheme();
  const today = new Date();
  const [filterTab, setFilterTab]   = useState<'free' | 'all' | 'gigs'>('all');
  const [monthOffset, setMonthOffset] = useState(0);

  const allEntries: EntryItem[] = (m.upcomingGigs || [])
    .filter(g => !!g.date)
    .map(g => { const d = new Date(g.date!); return { date: d, dateISO: isoDate(d), entry: g }; })
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
    if (filterTab === 'free')  return t === 'free';
    if (filterTab === 'gigs')  return t === 'gig';
    return true;
  });
  const monthGroups = groupByMonth(filtered);

  const countLabel = filterTab === 'free'
    ? `${filtered.length} free date${filtered.length !== 1 ? 's' : ''}`
    : filterTab === 'gigs'
      ? `${filtered.length} gig${filtered.length !== 1 ? 's' : ''}`
      : `${filtered.length} entr${filtered.length !== 1 ? 'ies' : 'y'}`;

  const rangeLabel = `(${LONG_MO[windowStart.getMonth()]} – ${LONG_MO[windowEnd.getMonth()]} ${windowEnd.getFullYear()})`;
  const musicianId   = m.id;
  const musicianName = m.name || 'Musician';

  if (isWeb) {
    return (
      <View style={mt.tabBody}>
        {/* Filter row */}
        <View style={mt.filterRow}>
          <View style={[mt.filterTabs, { borderColor: colors.border }]}>
            {(['free', 'all', 'gigs'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[mt.filterTab, filterTab === tab && mt.filterTabActive]}
                onPress={() => setFilterTab(tab)}
              >
                <Text style={[mt.filterTabText, { color: filterTab === tab ? '#111111' : colors.grey }]}>
                  {tab === 'free' ? 'Free' : tab === 'all' ? 'All' : 'Gigs'}
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
                <View style={[mt.calDot, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.orange }]} />
                <Text style={[mt.calLegendText, { color: colors.grey }]}>Free</Text>
              </View>
              <View style={mt.calLegendItem}>
                <View style={[mt.calDot, { backgroundColor: '#22c55e' }]} />
                <Text style={[mt.calLegendText, { color: colors.grey }]}>Booked</Text>
              </View>
              <View style={mt.calLegendItem}>
                <View style={[mt.calDot, { backgroundColor: '#e0e0e0' }]} />
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
              <Text style={[mt.emptyText, { color: colors.grey }]}>
                {allEntries.length === 0 ? 'No schedule listed yet.' : 'Nothing to show for this period.'}
              </Text>
            ) : (
              monthGroups.map(group => {
                const freeCount = group.items.filter(i => (i.entry.type || 'gig') === 'free').length;
                return (
                  <View key={`${group.year}-${group.month}`} style={mt.monthGroup}>
                    <View style={mt.monthHeader}>
                      <Text style={[mt.monthLabel, { color: colors.black }]}>
                        {LONG_MO[group.month].toUpperCase()} {group.year}
                      </Text>
                      {freeCount > 0 && (
                        <Text style={mt.monthFreeCount}>{freeCount} free</Text>
                      )}
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
      <View style={[nmt.filterRow, { borderBottomColor: colors.border }]}>
        <View style={[nmt.filterControl, { borderColor: colors.border }]}>
          {(['free', 'all', 'gigs'] as const).map((tab, i, arr) => (
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
                {tab === 'free' ? 'Free' : tab === 'all' ? 'All' : 'Gigs'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={[nmt.countNav, { borderBottomColor: colors.border }]}>
        <View style={nmt.countRow}>
          <Text style={[nmt.countLabel, { color: colors.grey }]}>{countLabel}</Text>
          <Text style={[nmt.dateRange, { color: colors.grey }]}>{rangeLabel}</Text>
        </View>
        <View style={nmt.navBtns}>
          {monthOffset > 0 && (
            <TouchableOpacity style={nmt.navBtn} onPress={() => setMonthOffset(o => o - 3)}>
              <Text style={[nmt.navBtnText, { color: colors.grey }]}>← Prev 3 months</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={nmt.navBtn} onPress={() => setMonthOffset(o => o + 3)}>
            <Text style={[nmt.navBtnText, { color: colors.grey }]}>Next 3 months →</Text>
          </TouchableOpacity>
        </View>
        <View style={nmt.legend}>
          {[
            { label: 'Free',   bg: 'transparent' as const, border: Colors.orange },
            { label: 'Booked', bg: '#22c55e',     border: '#22c55e'     },
            { label: 'Away',   bg: '#e0e0e0',     border: '#e0e0e0'     },
          ].map(({ label, bg, border }) => (
            <View key={label} style={nmt.legendItem}>
              <View style={[nmt.legendDot, { backgroundColor: bg, borderWidth: 1, borderColor: border }]} />
              <Text style={[nmt.legendText, { color: colors.grey }]}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      {monthGroups.length === 0 ? (
        <Text style={[nmt.emptyText, { color: colors.grey }]}>
          {allEntries.length === 0 ? 'No schedule listed yet.' : 'Nothing to show for this period.'}
        </Text>
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
  const [activeTab, setActiveTab] = useState<'overview' | 'music' | 'timetable'>(
    initialTab === 'music' ? 'music' : initialTab === 'timetable' ? 'timetable' : 'overview'
  );

  const isOwn = user?.uid === id;
  const { width } = useWindowDimensions();
  const isMobileLayout = !isWeb || width < 768;

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

  const hasFee = musician.feeMin != null || musician.feeMax != null;
  const feeStr = hasFee
    ? (musician.feeMin != null && musician.feeMax != null
        ? `$${musician.feeMin.toLocaleString()} – $${musician.feeMax.toLocaleString()}`
        : musician.feeMin != null
          ? `From $${musician.feeMin.toLocaleString()}`
          : `Up to $${musician.feeMax!.toLocaleString()}`)
    : null;

  const statsItems = [
    musician.averageDraw != null ? { value: String(musician.averageDraw), label: 'TYPICAL DRAW' } : null,
    gigsThisYear > 0             ? { value: String(gigsThisYear),         label: `GIGS IN ${year}` } : null,
    feeStr                       ? { value: feeStr,                        label: 'FEE'          } : null,
    musician.actSize             ? { value: musician.actSize,             label: 'ACT SIZE'     } : null,
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
          <View style={[styles.nameRow, isMobileLayout && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <Text style={[styles.name, { color: colors.black, flex: isMobileLayout ? undefined : 1 }]} numberOfLines={2}>
              {musician.name || 'Unnamed Act'}
            </Text>
            {isOwn && (
              <View style={[styles.ownerBtns, isMobileLayout && { marginTop: 10 }]}>
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
        {activeTab === 'overview'   && <OverviewTab m={musician} isMobileLayout={isMobileLayout} />}
        {activeTab === 'music'      && <MusicTab m={musician} />}
        {activeTab === 'timetable'  && <TimetableTab m={musician} isOwn={isOwn} />}

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
  mobileContent:   { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 24, paddingBottom: 4 },
  tabContent:      { paddingHorizontal: isWeb ? 40 : 20, paddingTop: 28 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 16,
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
    fontSize: 16, fontWeight: '700',
    letterSpacing: -0.2, marginBottom: 10,
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
  filterRow:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1 },
  filterControl: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  filterBtn:     { paddingHorizontal: 16, paddingVertical: 10 },
  filterBtnActive: { backgroundColor: Colors.orange },
  filterText:    { fontSize: 13, fontWeight: '700' },
  countNav:      { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
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
