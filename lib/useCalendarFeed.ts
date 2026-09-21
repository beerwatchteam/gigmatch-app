import { getFunctions, httpsCallable } from 'firebase/functions';
import app from './firebase';

const fns = getFunctions(app, 'australia-southeast1');

type FeedResult = { url: string };

/**
 * Fetch (or create) the caller's active calendar feed URL.
 * Requires the user to be signed in — Firebase callable handles auth verification.
 */
export async function getOrCreateCalendarFeed(): Promise<string> {
  const fn     = httpsCallable<void, FeedResult>(fns, 'getOrCreateCalendarFeed');
  const result = await fn();
  return result.data.url;
}

/**
 * Revoke the current feed token and return a new URL.
 * Old subscriptions will receive 404 on their next refresh.
 */
export async function rotateCalendarFeed(): Promise<string> {
  const fn     = httpsCallable<void, FeedResult>(fns, 'rotateCalendarFeed');
  const result = await fn();
  return result.data.url;
}
