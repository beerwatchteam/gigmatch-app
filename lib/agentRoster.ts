/**
 * Read-only helpers for the agent roster.
 *
 * These are one-shot async functions (not hooks) intended for the future
 * agent dashboard screen.  The live-subscription equivalent already exists
 * in useAgentEnquiries (lib/useEnquiries.ts), which drives the inbox strip.
 * Follow the same two-collection pattern here rather than introducing a
 * third approach.
 *
 * Agent write actions on behalf of clients are explicitly deferred.
 */

import {
  collection, getDocs, query, where,
  type DocumentData, type QuerySnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Gig } from './gig-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type RosterKind = 'artist' | 'venue';

export type AgentRosterEntry = {
  type: RosterKind;
  id: string;   // artistUid or venueId
  name: string;
};

/** Gig as returned by getRosterGigs — same shape as Gig but with a rosterEntity
 *  attached so callers know which roster client the gig belongs to. */
export type RosterGig = Gig & {
  rosterEntity: AgentRosterEntry;
};

// ── getAgentRoster ───────────────────────────────────────────────────────────

/**
 * Returns all approved roster members for an agent.
 * Mirrors the two queries in useAgentEnquiries (lib/useEnquiries.ts:187–206).
 *
 * agentRoster    where agentUid == agentUid  -> artist entries
 * agentVenueRoster where agentUid == agentUid -> venue entries
 */
export async function getAgentRoster(agentUid: string): Promise<{
  artists: AgentRosterEntry[];
  venues: AgentRosterEntry[];
  artistUids: string[];
  venueIds: string[];
}> {
  const [artistSnap, venueSnap] = await Promise.all([
    getDocs(query(collection(db, 'agentRoster'),      where('agentUid', '==', agentUid))),
    getDocs(query(collection(db, 'agentVenueRoster'), where('agentUid', '==', agentUid))),
  ]);

  const artists: AgentRosterEntry[] = artistSnap.docs.map(d => ({
    type: 'artist' as const,
    id:   d.data().artistUid as string,
    name: d.data().artistName as string,
  }));

  const venues: AgentRosterEntry[] = venueSnap.docs.map(d => ({
    type: 'venue' as const,
    id:   d.data().venueId as string,
    name: d.data().venueName as string,
  }));

  return {
    artists,
    venues,
    artistUids: artists.map(a => a.id),
    venueIds:   venues.map(v => v.id),
  };
}

// ── Batching helpers ─────────────────────────────────────────────────────────

/** Split an array into chunks of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function gigFromSnap(snap: QuerySnapshot<DocumentData>): Gig[] {
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Gig));
}

// ── getRosterGigs ─────────────────────────────────────────────────────────────

/**
 * Returns all gigs for every client on an agent's roster, merged and
 * de-duplicated by gig id.
 *
 * A gig that matches both an artist and a venue the agent represents (e.g. a
 * Twaylo enquiry booking between the two) is included once, with rosterEntity
 * set to the artist side by convention (since artistUid is always present on
 * enquiry gigs; venueId would also match, but one label is enough).
 *
 * Batching: Firestore `in` / `array-contains-any` operators accept at most 10
 * values per query.  Both artist and venue lists are split into groups of 10
 * and queried in parallel, then merged.
 *
 * NOTE — fee visibility: `fee` and `payment` live directly on the gig document
 * (see gig-types.ts:83–84, and the comment at line 56: "Fee fields stay here
 * so the dashboard can total them per-user").  An agent with read access to a
 * client's gigs will therefore see fee and payment data.  This is flagged to
 * the product owner as a decision point — see brief section D.
 */
export async function getRosterGigs(agentUid: string): Promise<RosterGig[]> {
  const { artists, venues, artistUids, venueIds } = await getAgentRoster(agentUid);

  if (artistUids.length === 0 && venueIds.length === 0) return [];

  // Build a lookup: clientId -> AgentRosterEntry for attaching rosterEntity
  const artistMap = new Map<string, AgentRosterEntry>(artists.map(a => [a.id, a]));
  const venueMap  = new Map<string, AgentRosterEntry>(venues.map(v => [v.id, v]));

  // Batch queries — max 10 per Firestore clause
  const artistChunks = chunk(artistUids, 10);
  const venueChunks  = chunk(venueIds,   10);

  const artistQueries = artistChunks.map(ids =>
    getDocs(query(collection(db, 'gigs'), where('participantIds', 'array-contains-any', ids)))
  );
  const venueQueries = venueChunks.map(ids =>
    getDocs(query(collection(db, 'gigs'), where('venueId', 'in', ids)))
  );

  const [artistSnaps, venueSnaps] = await Promise.all([
    Promise.all(artistQueries),
    Promise.all(venueQueries),
  ]);

  // Collect all gigs, artist-side first so artist entry wins on duplicates
  const gigMap = new Map<string, RosterGig>();

  for (const snap of artistSnaps) {
    for (const gig of gigFromSnap(snap)) {
      if (gigMap.has(gig.id)) continue;
      // Find which roster artist this gig belongs to
      const entry = gig.artistUid ? artistMap.get(gig.artistUid) : undefined;
      if (entry) gigMap.set(gig.id, { ...gig, rosterEntity: entry });
    }
  }

  for (const snap of venueSnaps) {
    for (const gig of gigFromSnap(snap)) {
      if (gigMap.has(gig.id)) continue; // already added by artist-side pass
      const entry = gig.venueId ? venueMap.get(gig.venueId) : undefined;
      if (entry) gigMap.set(gig.id, { ...gig, rosterEntity: entry });
    }
  }

  return Array.from(gigMap.values());
}
