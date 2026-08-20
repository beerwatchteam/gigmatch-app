import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

export default function ProfileTab() {
  const { user, profile, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!user) return <Redirect href="/login" />;

  if (profile?.type === 'venue' && profile?.venueId) {
    return <Redirect href="/edit-venue" />;
  }

  return <Redirect href="/edit-profile" />;
}
