import { ScrollView, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/Text';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/lib/theme-context';

const EFFECTIVE_DATE = '13 October 2026';
const CONTACT_EMAIL = 'twaylogigs@gmail.com';

export default function PrivacyScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.pageTitle}>Privacy Policy</Text>
        <Text style={s.effectiveDate}>Effective date: {EFFECTIVE_DATE}</Text>

        <Text style={s.intro}>
          Twaylo is committed to protecting your privacy. This policy explains what personal information we collect, how we use it, and your rights under the Australian Privacy Act 1988 (Cth).
        </Text>

        <Section title="1. Who We Are">
          <Body>
            Twaylo is an Australian live music booking platform that connects artists and bands with venue operators. Twaylo is operated from Victoria, Australia.
          </Body>
          <Body>
            If you have any questions about this policy or how we handle your information, contact us at {CONTACT_EMAIL}.
          </Body>
        </Section>

        <Section title="2. Information We Collect">
          <Body>
            When you create an account, we collect your email address and the user type you select (artist or venue).
          </Body>
          <Body>
            For artist profiles, we may collect: stage name, username, act type, genres, location, contact details, fee range, average draw, social media links, bio, music links, past gig history, availability, technical rider information, and photos you upload.
          </Body>
          <Body>
            For venue profiles, we may collect: venue name, address, suburb, capacity, genres booked, contact details, and photos you upload.
          </Body>
          <Body>
            We also collect messages and communications you send through the Twaylo platform, and information about your use of the app such as enquiries submitted and bookings confirmed.
          </Body>
        </Section>

        <Section title="3. How We Use Your Information">
          <Body>
            We use your information to operate and provide the Twaylo platform, including displaying your profile to other users, facilitating booking enquiries and communications between artists and venues, and managing your account.
          </Body>
          <Body>
            We may also use your information to send you notifications about activity on the platform (such as new enquiries or booking status updates), to improve and develop the platform, and to respond to your support requests.
          </Body>
          <Body>
            We will not use your personal information for unrelated purposes without your consent.
          </Body>
        </Section>

        <Section title="4. Disclosure of Your Information">
          <Body>
            Your profile information is visible to other registered users of the platform as part of normal platform operation. For example, artist profiles are visible to venues, and venue profiles and timetables are visible to artists.
          </Body>
          <Body>
            We do not sell your personal information to third parties.
          </Body>
          <Body>
            We may disclose your information to third-party service providers who assist us in operating the platform, including Google (Firebase) for authentication and data storage. These providers are required to handle your information securely and only for the purposes we specify.
          </Body>
          <Body>
            We may disclose your information if required to do so by law or in response to a valid legal request.
          </Body>
        </Section>

        <Section title="5. Third-Party Services">
          <Body>
            Twaylo uses Firebase (provided by Google) for user authentication and data storage. Your data is stored on Google's servers. Google's privacy policy applies to the handling of your data by Firebase. We encourage you to review Google's privacy policy at policies.google.com/privacy.
          </Body>
          <Body>
            The Twaylo mobile app is built using Expo. Expo may collect certain usage and diagnostic information in accordance with their privacy policy.
          </Body>
        </Section>

        <Section title="6. Data Storage and Security">
          <Body>
            Your data is stored on servers operated by Google (Firebase). While these servers may be located outside Australia, we take reasonable steps to ensure your information is handled securely and in accordance with the Australian Privacy Principles.
          </Body>
          <Body>
            We take reasonable technical and organisational measures to protect your personal information from unauthorised access, loss, or disclosure. However, no internet transmission is completely secure and we cannot guarantee absolute security.
          </Body>
        </Section>

        <Section title="7. Data Retention">
          <Body>
            We retain your personal information for as long as your account is active or as needed to provide you with the platform's services. If you delete your account, we will remove your personal information in accordance with our data retention practices, except where we are required to retain it by law.
          </Body>
        </Section>

        <Section title="8. Your Rights">
          <Body>
            Under the Australian Privacy Act 1988, you have the right to access the personal information we hold about you and to request corrections if it is inaccurate, incomplete, or out of date.
          </Body>
          <Body>
            You may update most of your profile information directly within the app at any time. To request access to, or correction of, your personal information, or to request deletion of your account and data, contact us at {CONTACT_EMAIL}.
          </Body>
          <Body>
            If you believe we have breached the Australian Privacy Principles, you may contact us first to raise your concern. If you are not satisfied with our response, you have the right to make a complaint to the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au.
          </Body>
        </Section>

        <Section title="9. Cookies and Tracking">
          <Body>
            The Twaylo web platform may use session cookies and local storage to maintain your login state and improve your experience. We do not use tracking cookies for advertising purposes.
          </Body>
        </Section>

        <Section title="10. Children's Privacy">
          <Body>
            Twaylo is not intended for use by anyone under the age of 18. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us at {CONTACT_EMAIL} and we will take steps to remove it.
          </Body>
        </Section>

        <Section title="11. Changes to This Policy">
          <Body>
            We may update this Privacy Policy from time to time. When we make material changes, we will post a notice on the platform or notify you by email. Your continued use of Twaylo after changes take effect constitutes acceptance of the updated policy.
          </Body>
        </Section>

        <Section title="12. Contact Us">
          <Body>
            If you have any questions, concerns, or requests relating to this Privacy Policy or how we handle your personal information, please contact us at {CONTACT_EMAIL}.
          </Body>
        </Section>

        <View style={s.footer}>
          <Text style={s.footerText}>Twaylo - {EFFECTIVE_DATE}</Text>
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
