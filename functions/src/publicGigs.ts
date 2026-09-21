import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ── Types (mirrored from lib/gig-types.ts — no shared code between app and functions) ──

type GigSource = 'enquiry' | 'venue_created' | 'artist_added';

type GigData = {
  artistUid:        string | null;
  venueId:          string | null;
  venueName:        string | null;
  venueUid:         string | null;
  artistName:       string | null;
  bandName:         string;
  title:            string | null;
  description:      string | null;
  locationText:     string | null;
  state:            string | null;
  isPublic:         boolean;
  status:           string;
  source:           GigSource;
  startAt:          FirebaseFirestore.Timestamp;
  endAt:            FirebaseFirestore.Timestamp | null;
  timezone:         string;
  room:             string | null;
  fee:              { ticketUrl?: string | null; ticketPriceCents?: number | null };
  participantIds:   string[];
};

type PublicGigDoc = {
  gigId:            string;
  artistUid:        string;
  venueId:          string | null;
  title:            string | null;
  actName:          string | null;
  venueName:        string | null;
  room:             string | null;
  locationText:     string | null;
  state:            string | null;
  date:             string;
  startAt:          FirebaseFirestore.Timestamp;
  endAt:            FirebaseFirestore.Timestamp;
  timezone:         string;
  description:      string | null;
  ticketUrl:        string | null;
  ticketPriceCents: number | null;
  source:           'enquiry' | 'artist_added';
};

// ── Local date from Timestamp + IANA timezone ────────────────────────────────

const STATE_TZ: Record<string, string> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
  SA:  'Australia/Adelaide',
  WA:  'Australia/Perth',
  TAS: 'Australia/Hobart',
  NT:  'Australia/Darwin',
  ACT: 'Australia/Sydney',
};

function localDateString(ts: FirebaseFirestore.Timestamp, timezone: string): string {
  const date = ts.toDate();
  const fmt  = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value  ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value   ?? '01';
  return `${y}-${m}-${d}`;
}

// ── Build projection from gig doc ────────────────────────────────────────────

function buildPublicGig(gigId: string, data: GigData): PublicGigDoc | null {
  if (!data.artistUid) return null; // venue_created gigs never get a projection
  if (data.source === 'venue_created') return null;
  if (!data.isPublic) return null;
  if (data.status !== 'confirmed') return null;

  const timezone = data.timezone
    || (data.state ? (STATE_TZ[data.state] ?? 'Australia/Melbourne') : 'Australia/Melbourne');

  // endAt falls back to startAt + 60 min if not set
  const endAt = data.endAt
    ?? Timestamp.fromDate(new Date(data.startAt.toDate().getTime() + 60 * 60_000));

  // Explicit allow-list — never copy fee, private, or agreement ids
  return {
    gigId,
    artistUid:        data.artistUid,
    venueId:          data.venueId   ?? null,
    title:            data.title     ?? null,
    actName:          data.artistName ?? data.bandName ?? null,
    venueName:        data.venueName ?? null,
    room:             data.room      ?? null,
    locationText:     data.locationText ?? null,
    state:            data.state     ?? null,
    date:             localDateString(data.startAt, timezone),
    startAt:          data.startAt,
    endAt,
    timezone,
    description:      data.description ?? null,
    ticketUrl:        data.fee?.ticketUrl        ?? null,
    ticketPriceCents: data.fee?.ticketPriceCents ?? null,
    source:           data.source as 'enquiry' | 'artist_added',
  };
}

// ── Trigger ──────────────────────────────────────────────────────────────────

/**
 * Keeps publicGigs in sync with the gigs collection.
 *
 * - Gig deleted              → delete publicGigs/{gigId}
 * - isPublic true + confirmed + artistUid set → set projection
 * - Otherwise                → delete publicGigs/{gigId} if it exists
 *
 * Runs in australia-southeast1 (same region as Firestore).
 * Typical propagation delay: 1-5 seconds after the gig write lands.
 */
export const syncPublicGig = onDocumentWritten('gigs/{gigId}', async (event) => {
  const gigId = event.params.gigId;
  const db    = getFirestore();
  const pubRef = db.collection('publicGigs').doc(gigId);

  try {
    // Deleted
    if (!event.data?.after?.exists) {
      await pubRef.delete();
      console.log(`[syncPublicGig] deleted publicGigs/${gigId}`);
      return;
    }

    const after = event.data.after.data() as GigData | undefined;
    if (!after) {
      await pubRef.delete();
      return;
    }

    const projection = buildPublicGig(gigId, after);

    if (projection) {
      await pubRef.set(projection);
      console.log(`[syncPublicGig] upserted publicGigs/${gigId}`);
    } else {
      await pubRef.delete();
      console.log(`[syncPublicGig] removed publicGigs/${gigId} (not eligible)`);
    }
  } catch (err) {
    console.error(`[syncPublicGig] error for gigs/${gigId}:`, err);
  }
});

// ── Dev helper: resync all public gigs ───────────────────────────────────────

import { onCall, HttpsError } from 'firebase-functions/v2/https';

/**
 * Callable function for admins to rebuild all publicGigs projections from gigs.
 * The gig doc always wins. Run this if the trigger had downtime or drift.
 */
export const resyncPublicGigs = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

  // Verify admin via custom claim or users collection
  const db      = getFirestore();
  const userSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (userSnap.data()?.type !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  const db2   = getFirestore();
  const gigs  = await db2.collection('gigs').get();
  const batch = db2.batch();
  let  synced = 0;
  let  removed = 0;

  for (const gigDoc of gigs.docs) {
    const gigId     = gigDoc.id;
    const data      = gigDoc.data() as GigData;
    const pubRef    = db2.collection('publicGigs').doc(gigId);
    const projection = buildPublicGig(gigId, data);

    if (projection) {
      batch.set(pubRef, projection);
      synced++;
    } else {
      batch.delete(pubRef);
      removed++;
    }
  }

  await batch.commit();
  console.log(`[resyncPublicGigs] synced=${synced} removed=${removed}`);
  return { synced, removed };
});
