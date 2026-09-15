// Single source of truth for marketing copy shared between
// the in-app home screen (app/(tabs)/index.tsx) and the
// web landing page (components/landing/).

export const HERO_HEADLINE = 'Book gigs in one click.';
export const HERO_HEADLINE_LINE2 = 'Simple.';

export const HERO_SUBHEAD =
  "Venues publish open gig slots on a live timetable. Artists enquire in one click, straight off a profile they've already built. No cold DMs, no waiting to be discovered. Create, Enquire, Book.";

export const HERO_STATS: { num: string; label: string }[] = [
  { num: 'AU',   label: 'Built for the Australian live music market' },
  { num: '0',    label: 'Cold DMs needed to find a slot' },
  { num: '100%', label: 'Every venue verified before going live' },
];

export const PROBLEM_SECTION_HEADING = 'Booking live music is still done the old way.';

export const PROBLEMS: { title: string; bullets: string[] }[] = [
  {
    title: 'No visibility',
    bullets: [
      "Artists scroll Facebook groups and cold-email venues with no idea if there's even a slot free.",
      "You find out what's available by asking, and mostly by guessing.",
    ],
  },
  {
    title: 'Endless back-and-forth',
    bullets: [
      'Set times and fees get hashed out across texts, Instagram DMs, and phone tag.',
      "Nothing's confirmed until someone finally writes it down, usually days later.",
    ],
  },
  {
    title: 'Silence instead of answers',
    bullets: [
      'Enquiries go unanswered for weeks, with no way to track where things stand.',
      'Artists are left chasing, and venues fall behind on managing incoming requests.',
    ],
  },
];
