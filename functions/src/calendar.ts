import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import ical from 'ical-generator';

setGlobalOptions({ region: 'australia-southeast1' });

/**
 * Stable base URL for calendar feed links.
 * The Firebase Hosting rewrite exposes the function at this path so the URL
 * does not change between function re-deploys or if the underlying Cloud Run
 * hash changes.  Switch this to a custom domain later without touching the app.
 */
const FEED_BASE_URL = 'https://gigmatchweb-aus.web.app/calendarFeed';

// ── getOrCreateCalendarFeed ──────────────────────────────────────────────────

/**
 * Returns the authenticated user's active calendar feed URL, creating a new
 * token if one does not exist.
 */
export const getOrCreateCalendarFeed = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const uid = request.auth.uid;
  const db  = getFirestore();

  // Return existing active feed if present
  const existing = await db.collection('calendarFeeds')
    .where('uid', '==', uid)
    .where('revokedAt', '==', null)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { url: `${FEED_BASE_URL}/${existing.docs[0].id}.ics` };
  }

  // Create new token
  const token    = randomBytes(32).toString('base64url');
  const userSnap = await db.doc(`users/${uid}`).get();
  const role: 'artist' | 'venue' =
    (userSnap.data()?.type as string | undefined) === 'venue' ? 'venue' : 'artist';

  await db.collection('calendarFeeds').doc(token).set({
    uid,
    role,
    createdAt: Timestamp.now(),
    revokedAt: null,
  });

  return { url: `${FEED_BASE_URL}/${token}.ics` };
});

// ── rotateCalendarFeed ───────────────────────────────────────────────────────

/**
 * Revokes all existing feed tokens for the authenticated user and creates a
 * fresh one.  The old URL will return 404 immediately.
 */
export const rotateCalendarFeed = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const uid = request.auth.uid;
  const db  = getFirestore();
  const now = Timestamp.now();

  // Revoke all active tokens
  const activeSnap = await db.collection('calendarFeeds')
    .where('uid', '==', uid)
    .where('revokedAt', '==', null)
    .get();

  const batch = db.batch();
  for (const d of activeSnap.docs) {
    batch.update(d.ref, { revokedAt: now });
  }

  // Create replacement token
  const token    = randomBytes(32).toString('base64url');
  const userSnap = await db.doc(`users/${uid}`).get();
  const role: 'artist' | 'venue' =
    (userSnap.data()?.type as string | undefined) === 'venue' ? 'venue' : 'artist';

  batch.set(db.collection('calendarFeeds').doc(token), {
    uid,
    role,
    createdAt: now,
    revokedAt: null,
  });

  await batch.commit();

  return { url: `${FEED_BASE_URL}/${token}.ics` };
});

// ── calendarFeed (HTTPS) ─────────────────────────────────────────────────────

/**
 * Token-authenticated ICS feed.  The token is the document ID in calendarFeeds
 * and is the only credential — treat the URL as a secret.
 *
 * Path: /calendarFeed/<token>.ics  (routed here via Firebase Hosting rewrite)
 */
export const calendarFeed = onRequest({ invoker: 'public' }, async (req, res) => {
  try {
    // Extract token: works for both "/calendarFeed/<t>.ics" and "/<t>.ics"
    const token = req.path.split('/').pop()?.replace(/\.ics$/, '') ?? '';
    if (!token) {
      res.status(404).end();
      return;
    }

    const db = getFirestore();

    // Validate token — no detail on failure to prevent oracle attacks
    const feedSnap = await db.collection('calendarFeeds').doc(token).get();
    if (!feedSnap.exists || feedSnap.data()?.revokedAt !== null) {
      res.status(404).end();
      return;
    }

    const { uid } = feedSnap.data() as { uid: string };

    // 90-day lookback window
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const gigsSnap = await db.collection('gigs')
      .where('participantIds', 'array-contains', uid)
      .where('status', '==', 'confirmed')
      .where('startAt', '>=', Timestamp.fromDate(ninetyDaysAgo))
      .orderBy('startAt', 'asc')
      .get();

    // Batch-load venues for street addresses (deduplicated)
    const venueIds = [
      ...new Set(
        gigsSnap.docs
          .map(d => d.data().venueId as string | undefined)
          .filter((v): v is string => !!v),
      ),
    ];

    const venueMap = new Map<string, FirebaseFirestore.DocumentData>();
    if (venueIds.length > 0) {
      const refs  = venueIds.map(id => db.doc(`venues/${id}`));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) venueMap.set(snap.id, snap.data()!);
      }
    }

    // Build ICS
    const cal = ical({ name: 'Twaylo gigs' });
    cal.x([
      { key: 'X-WR-CALNAME',    value: 'Twaylo gigs' },
      { key: 'X-PUBLISHED-TTL', value: 'PT1H' },
    ]);

    for (const gigDoc of gigsSnap.docs) {
      const gig   = gigDoc.data();
      const venue = gig.venueId ? (venueMap.get(gig.venueId as string) ?? null) : null;

      const startDate   = (gig.startAt as Timestamp).toDate();
      const setLengthMs = ((gig.setLengthMinutes as number | undefined) ?? 60) * 60_000;
      const endDate     = new Date(startDate.getTime() + setLengthMs);

      // LOCATION
      let location = '';
      if (venue) {
        const addrParts = [
          venue.streetAddress,
          venue.suburb,
          [venue.state, venue.postcode].filter(Boolean).join(' '),
        ].filter(Boolean);
        location = addrParts.join(', ') || (venue.name as string | undefined) || '';
      } else if (gig.externalVenueName) {
        location = [gig.externalVenueName, gig.locationText].filter(Boolean).join(', ');
      }

      // DESCRIPTION — no fee data per design requirement
      const descLines: string[] = [];
      if (gig.setLengthMinutes) descLines.push(`Set length: ${gig.setLengthMinutes} min`);
      if (gig.loadInTime)       descLines.push(`Load-in: ${gig.loadInTime}`);
      if (gig.soundCheckTime)   descLines.push(`Soundcheck: ${gig.soundCheckTime}`);
      if (gig.fee?.ticketUrl)   descLines.push(`Tickets: ${gig.fee.ticketUrl}`);
      if (gig.notes)            descLines.push(`Notes: ${gig.notes}`);
      descLines.push('For more information check twaylo.com.au');

      // SUMMARY
      const summary = gig.bandName && gig.venueName
        ? `${gig.bandName} @ ${gig.venueName}`
        : (gig.bandName ?? gig.venueName ?? (gig.title as string | undefined) ?? 'Gig');

      cal.createEvent({
        id:          `${gigDoc.id}@twaylo.com.au`,
        start:       startDate,
        end:         endDate,
        summary,
        ...(location ? { location } : {}),
        description: descLines.join('\n'),
      });
    }

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(cal.toString());
  } catch (err) {
    console.error('[calendarFeed] error:', err);
    // Never leak internal detail to the caller
    res.status(500).end();
  }
});
