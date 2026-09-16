# About GigMatch

GigMatch is an Australian live music booking platform that connects artists/bands with venues. Artists browse venues, view available gig slots on a timetable, and send booking enquiries. Venues manage their slots, review incoming enquiries, and accept or decline them. There is an in-app messaging system for both parties to communicate throughout the process. Three user types: artist, venue, and admin (who verifies venues before they go live).

**Design intent:** Premium industry tool — confident, clean, and built for people who take live music seriously. Not a consumer social app, not corporate software. Somewhere between a music discovery platform and a professional booking tool. Every screen should reflect that.

# Pending / Notes

Things that still need to be done — check here when asked "what's left to do":

- **Slots performance — future refactor**: `bookSlotOnTimetable` and `cancelAcceptance` in `lib/useEnquiries.ts` do a `getDoc` read before every write because slots are stored as an array inside the venue document. To make these optimistic, migrate slots to a subcollection (`venues/{venueId}/slots/{slotId}`) so each slot can be updated directly. Left as-is for now — it's a low-frequency action and the latency is acceptable.

- **Email sending for venue verification codes**: Need to create a Gmail account, enable 2FA, then generate an App Password under Google Account → Security → App Passwords. Store the App Password in `.env` as `GMAIL_APP_PASSWORD` and the Gmail address as `GMAIL_FROM`. Then wire up the email-sending logic in the admin code-generation flow so the code gets emailed automatically when admin clicks "Generate Code". See `.env` for the key names.

- **Onboarding flow**: Build an in-app onboarding experience that appears on first login for both user types. Content is already written — implement as a step-by-step tooltip overlay or modal. Details below:

  **Artist onboarding:**
  - Step 1 (Account created): "Welcome. Your account is set up. Now let's build your profile so venues can judge you properly."
  - Point to Profile tab. Explain the 8 tabs: Basic Info, About, Music, Past Gigs, Timetable, Tech Rider, Photos, Settings.
  - Basic Info: stage name, username, act type, genres, location, contact, fee range, average draw, social links.
  - About: short bio.
  - Music: song/track links so venues can listen before responding.
  - Past Gigs: log previous performances to build credibility.
  - Timetable: set general availability.
  - Tech Rider: monitoring, backline, stage size, soundcheck notes, stage plot, input list.
  - Photos: upload act photos.
  - Final step: "Hit Save to publish your profile. Venues will find you in the musicians directory."

  **Venue onboarding:**
  - Step 1 (After verification): "Your venue has been verified. Time to publish your timetable."
  - Point to Profile tab. Fill in venue details: address, suburb, capacity, genres booked, photos.
  - Point to Timetable tab. "Add your band nights — room by room. Set recurring weekly slots or specific dates."
  - Final step: "Once your timetable is live, artists can see your open slots and send enquiries straight to your inbox."

---

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Security

Before presenting any generated code, review it for OWASP Top 10 vulnerabilities including SQL injection, XSS, command injection, insecure authentication, sensitive data exposure, and broken access control. If an issue is found, fix it before showing the code.

# Craft

Build with intention, style, and beauty. Put time and effort into the work. There is no need to cut corners — we will only have to fix it later. Every screen, every interaction, every detail matters. Do it right the first time.
