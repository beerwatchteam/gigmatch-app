import { ScrollView, View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';

const CONTACT_EMAIL = 'twaylogigs@gmail.com';

export default function SupportScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.pageTitle}>Support</Text>
        <Text style={s.subtitle}>We're here to help.</Text>

        <TouchableOpacity
          style={s.emailCard}
          onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
          accessibilityRole="button"
          accessibilityLabel="Send support email"
        >
          <Text style={s.emailLabel}>Email us</Text>
          <Text style={s.emailAddress}>{CONTACT_EMAIL}</Text>
          <Text style={s.emailNote}>We aim to respond within 1 business day.</Text>
        </TouchableOpacity>

        <Section title="Account">
          <FAQ
            q="How do I create an account?"
            a="Download the Twaylo app and tap Get Started. Choose whether you are an artist or a venue, then follow the prompts to set up your profile."
          />
          <FAQ
            q="How do I delete my account?"
            a="Go to your Profile, then Settings, and select Delete Account. Your data will be removed in accordance with our Privacy Policy. If you have trouble, email us and we will handle it for you."
          />
          <FAQ
            q="I forgot my password."
            a="On the login screen, tap Forgot Password and enter your email address. You will receive a reset link shortly. Check your spam folder if it doesn't arrive within a few minutes."
          />
        </Section>

        <Section title="Venues">
          <FAQ
            q="How does venue verification work?"
            a="Venue accounts require approval before going live. After you register, our team reviews your details and sends a verification code to activate your account. This usually takes 1 to 2 business days."
          />
          <FAQ
            q="How do I add gig slots to my timetable?"
            a="Go to your Profile and open the Timetable tab. You can add recurring weekly slots or one-off dates, specify the room, set the status to open, and publish them for artists to see."
          />
          <FAQ
            q="How do I respond to a booking enquiry?"
            a="Open the Inbox tab. Tap the enquiry to view the details, then use the Accept or Decline options. You can also message the artist directly from within the enquiry thread."
          />
        </Section>

        <Section title="Artists">
          <FAQ
            q="How do I find venues to play at?"
            a="Go to the Venues tab to browse listed venues and view their open gig slots on the timetable. Tap a slot to send a booking enquiry directly to the venue."
          />
          <FAQ
            q="Why hasn't a venue responded to my enquiry?"
            a="Response times vary between venues. You can send a follow-up message through the enquiry thread in your Inbox. If a venue is unresponsive, you are free to reach out to others."
          />
          <FAQ
            q="How do I make my profile visible to venues?"
            a="Complete your profile and tap Save. Make sure your Basic Info, About, and Music sections are filled in so venues have enough to make a decision."
          />
        </Section>

        <Section title="Bookings">
          <FAQ
            q="What does it mean when a booking is confirmed?"
            a="A confirmed booking means the venue has accepted your enquiry within the platform. Any further details such as payment, set times, and tech requirements should be arranged directly between you and the venue."
          />
          <FAQ
            q="Does Twaylo charge a fee on bookings?"
            a="No. Twaylo does not take a commission or charge fees on bookings at this time."
          />
        </Section>

        <Section title="Technical">
          <FAQ
            q="The app is not loading correctly."
            a="Try closing the app fully and reopening it. If the issue persists, check your internet connection or try uninstalling and reinstalling the app. If problems continue, email us with a description of what's happening and we will look into it."
          />
          <FAQ
            q="I found a bug."
            a={`Please email us at ${CONTACT_EMAIL} with a description of the issue and what steps led to it. Screenshots are very helpful. We take bugs seriously and will investigate as soon as possible.`}
          />
        </Section>

        <View style={s.footer}>
          <Text style={s.footerText}>Twaylo Support</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <View style={s.faq}>
      <Text style={s.faqQ}>{q}</Text>
      <Text style={s.faqA}>{a}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 24, paddingBottom: 60 },

  backBtn: { marginBottom: 24 },
  backText: { fontSize: 15, color: Colors.orange, fontWeight: '600' },

  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#888888',
    marginBottom: 28,
  },

  emailCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 20,
    marginBottom: 36,
    borderLeftWidth: 3,
    borderLeftColor: Colors.orange,
  },
  emailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888888',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  emailAddress: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.orange,
    marginBottom: 6,
  },
  emailNote: {
    fontSize: 13,
    color: '#888888',
  },

  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 12,
  },

  faq: {
    marginBottom: 18,
  },
  faqQ: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222222',
    marginBottom: 4,
    lineHeight: 20,
  },
  faqA: {
    fontSize: 14,
    color: '#555555',
    lineHeight: 22,
  },

  footer: {
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    paddingTop: 20,
    marginTop: 8,
    alignItems: 'center',
  },
  footerText: { fontSize: 12, color: '#aaaaaa' },
});
