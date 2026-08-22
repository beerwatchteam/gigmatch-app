import { ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import VenueScreen from '../venue/[id]';
import MusicianScreen from '../musician/[id]';

export default function ProfileTab() {
  const { user, profile, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.orange} />
      </SafeAreaView>
    );
  }

  if (!user) return <Redirect href="/login" />;

  if (profile?.type === 'venue' && profile?.venueId) {
    return <VenueScreen _overrideId={profile.venueId} />;
  }

  return <MusicianScreen _overrideId={user.uid} />;
}
