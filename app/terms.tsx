import { ScrollView, View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';

const EFFECTIVE_DATE = '15 September 2026';
const CONTACT_EMAIL = 'beerbozosupport@gmail.com';

export default function TermsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.pageTitle}>Terms and Conditions</Text>
        <Text style={s.effectiveDate}>Effective date: {EFFECTIVE_DATE}</Text>

        <Text style={s.intro}>
          Please read these Terms and Conditions carefully before using KordUp. By creating an account or using the platform, you confirm that you have read, understood, and agree to be bound by these terms.
        </Text>

        <Section title="1. About KordUp">
          <Body>
            KordUp is an Australian online platform that connects live music artists, bands, and booking agents with venue operators. KordUp facilitates communication and enquiries between parties but is not a party to any booking agreement, performance contract, or financial arrangement between artists and venues.
          </Body>
          <Body>
            KordUp is operated from Australia. These Terms are governed by the laws of Victoria, Australia.
          </Body>
        </Section>

        <Section title="2. Acceptance of Terms">
          <Body>
            By registering an account, you agree to these Terms and Conditions, our Privacy Policy, and any additional guidelines posted on the platform. If you do not agree, you must not use KordUp.
          </Body>
          <Body>
            We may update these Terms from time to time. We will notify you of material changes by posting a notice on the platform or by email. Continued use after changes take effect constitutes acceptance of the updated Terms.
          </Body>
        </Section>

        <Section title="3. Eligibility">
          <Body>
            You must be at least 18 years of age to create an account on KordUp. By registering, you confirm that you meet this requirement and that the information you provide is accurate and current.
          </Body>
          <Body>
            Venue accounts require verification and approval by KordUp before the account becomes active. KordUp reserves the right to decline or revoke venue approval at its sole discretion.
          </Body>
        </Section>

        <Section title="4. Account Registration and Security">
          <Body>
            You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must not share your account with others or allow others to use your account.
          </Body>
          <Body>
            You must notify us immediately at {CONTACT_EMAIL} if you become aware of any unauthorised access to or use of your account.
          </Body>
          <Body>
            Usernames must be unique and must not impersonate another person, business, or brand. KordUp reserves the right to reclaim or reassign usernames that violate these Terms.
          </Body>
        </Section>

        <Section title="5. Artist and Venue Responsibilities">
          <Body>
            Artists and agents agree to: provide accurate information about themselves and their act; respond to venue enquiries in a timely and professional manner; honour any confirmed bookings or communicate cancellations promptly.
          </Body>
          <Body>
            Venues agree to: provide accurate information about their venue and available gig slots; review and respond to artist enquiries promptly; honour confirmed bookings or communicate cancellations promptly; ensure all gig slot information is current and up to date.
          </Body>
          <Body>
            All users agree to conduct themselves professionally and respectfully in all communications made through the KordUp platform.
          </Body>
        </Section>

        <Section title="6. Booking Enquiries">
          <Body>
            KordUp enables artists to submit booking enquiries to venues and enables venues to review and respond to those enquiries. An enquiry submitted through KordUp does not constitute a confirmed booking.
          </Body>
          <Body>
            A booking is only confirmed when the venue explicitly accepts the enquiry within the platform. Any additional terms of engagement (payment, set times, technical requirements, etc.) are the sole responsibility of the artist and the venue to agree upon directly. KordUp is not responsible for the performance, non-performance, or outcome of any booking.
          </Body>
          <Body>
            KordUp does not charge commission or fees on bookings at this time. This may change in the future with notice.
          </Body>
        </Section>

        <Section title="7. User Content">
          <Body>
            You retain ownership of content you submit to KordUp, including profile information, photos, bio text, and messages. By submitting content, you grant KordUp a non-exclusive, royalty-free, worldwide licence to display and use that content for the purpose of operating and promoting the platform.
          </Body>
          <Body>
            You are solely responsible for the content you post. You must not post content that is false or misleading; defamatory, offensive, or harassing; infringing on the intellectual property rights of any third party; or in breach of any applicable law.
          </Body>
          <Body>
            KordUp reserves the right to remove any content that violates these Terms without notice.
          </Body>
        </Section>

        <Section title="8. Prohibited Conduct">
          <Body>
            You must not use KordUp to: impersonate any person or entity; engage in spam, phishing, or unsolicited commercial communications; harvest or collect user data without authorisation; attempt to gain unauthorised access to any part of the platform or another user's account; use the platform for any unlawful purpose; or interfere with the operation or security of the platform.
          </Body>
          <Body>
            Violation of these rules may result in immediate account suspension or termination.
          </Body>
        </Section>

        <Section title="9. Intellectual Property">
          <Body>
            All intellectual property in the KordUp platform, including its design, software, trademarks, and brand, is owned by or licensed to KordUp. You must not reproduce, modify, distribute, or exploit any part of the platform without our prior written consent.
          </Body>
        </Section>

        <Section title="10. Privacy">
          <Body>
            KordUp collects and handles personal information in accordance with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles. Please review our Privacy Policy for full details on how we collect, use, store, and disclose your personal information.
          </Body>
          <Body>
            By using KordUp, you consent to the collection and use of your information as described in our Privacy Policy.
          </Body>
        </Section>

        <Section title="11. Third-Party Services">
          <Body>
            KordUp uses third-party services including Firebase (Google) for authentication and data storage. Your use of KordUp is subject to the terms and privacy policies of these third-party providers. KordUp is not responsible for the practices of third-party services.
          </Body>
        </Section>

        <Section title="12. Disclaimers">
          <Body>
            KordUp is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, KordUp makes no warranties, express or implied, regarding the platform including its availability, accuracy, reliability, or suitability for any purpose.
          </Body>
          <Body>
            KordUp does not guarantee that the platform will be free from errors or interruptions, or that any booking enquiry will result in a confirmed gig.
          </Body>
          <Body>
            Nothing in these Terms limits any rights you may have under the Australian Consumer Law.
          </Body>
        </Section>

        <Section title="13. Limitation of Liability">
          <Body>
            To the maximum extent permitted by applicable law, KordUp and its officers, employees, and agents will not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the platform, including loss of bookings, revenue, reputation, or data.
          </Body>
          <Body>
            Where liability cannot be excluded under the Australian Consumer Law, KordUp's total liability to you is limited to the resupply of the relevant service.
          </Body>
        </Section>

        <Section title="14. Indemnification">
          <Body>
            You agree to indemnify and hold harmless KordUp and its officers, employees, and agents from any claims, losses, damages, or expenses (including legal fees) arising from your breach of these Terms, your use of the platform, or your interactions with other users.
          </Body>
        </Section>

        <Section title="15. Account Suspension and Termination">
          <Body>
            KordUp may suspend or terminate your account at any time if you breach these Terms, engage in conduct that is harmful to other users or the platform, or for any other reason at our sole discretion.
          </Body>
          <Body>
            You may delete your account at any time via the Profile settings in the app. Upon deletion, your account data will be removed in accordance with our Privacy Policy.
          </Body>
        </Section>

        <Section title="16. Dispute Resolution">
          <Body>
            If you have a dispute with another user arising from a booking or communication on KordUp, we encourage you to resolve it directly. KordUp may assist in facilitating resolution but is not obligated to act as arbitrator.
          </Body>
          <Body>
            Any dispute between you and KordUp that cannot be resolved informally shall be subject to the jurisdiction of the courts of Victoria, Australia.
          </Body>
        </Section>

        <Section title="17. Governing Law">
          <Body>
            These Terms are governed by and construed in accordance with the laws of Victoria, Australia. You submit to the exclusive jurisdiction of the courts of Victoria for any proceedings arising out of or relating to these Terms or your use of KordUp.
          </Body>
        </Section>

        <Section title="18. Contact Us">
          <Body>
            If you have any questions about these Terms or the KordUp platform, please contact us at {CONTACT_EMAIL}.
          </Body>
        </Section>

        <View style={s.footer}>
          <Text style={s.footerText}>KordUp - {EFFECTIVE_DATE}</Text>
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

function Body({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
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
    marginBottom: 6,
  },
  effectiveDate: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 20,
  },
  intro: {
    fontSize: 14,
    color: '#444444',
    lineHeight: 22,
    marginBottom: 28,
    padding: 16,
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.orange,
  },

  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    color: '#444444',
    lineHeight: 22,
    marginBottom: 10,
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
