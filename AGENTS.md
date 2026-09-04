# Pending / Notes

Things that still need to be done — check here when asked "what's left to do":

- **Slots performance — future refactor**: `bookSlotOnTimetable` and `cancelAcceptance` in `lib/useEnquiries.ts` do a `getDoc` read before every write because slots are stored as an array inside the venue document. To make these optimistic, migrate slots to a subcollection (`venues/{venueId}/slots/{slotId}`) so each slot can be updated directly. Left as-is for now — it's a low-frequency action and the latency is acceptable.

- **Email sending for venue verification codes**: Need to create a Gmail account, enable 2FA, then generate an App Password under Google Account → Security → App Passwords. Store the App Password in `.env` as `GMAIL_APP_PASSWORD` and the Gmail address as `GMAIL_FROM`. Then wire up the email-sending logic in the admin code-generation flow so the code gets emailed automatically when admin clicks "Generate Code". See `.env` for the key names.

---

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Security

Before presenting any generated code, review it for OWASP Top 10 vulnerabilities including SQL injection, XSS, command injection, insecure authentication, sensitive data exposure, and broken access control. If an issue is found, fix it before showing the code.

# Craft

Build with intention, style, and beauty. Put time and effort into the work. There is no need to cut corners — we will only have to fix it later. Every screen, every interaction, every detail matters. Do it right the first time.
