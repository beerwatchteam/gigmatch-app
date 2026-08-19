import { View, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

export default function TabsLayout() {
  const isWeb = Platform.OS === 'web';
  const { user, profile } = useAuth();
  const { colors } = useTheme();

  const profileTabTitle = !user
    ? 'Profile'
    : profile?.type === 'venue'
      ? 'My Venue'
      : 'My Profile';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.orange,
          tabBarInactiveTintColor: colors.greyLight,
          tabBarStyle: isWeb
            ? { display: 'none' }
            : {
                backgroundColor: colors.bg,
                borderTopColor: colors.border,
                borderTopWidth: 1,
                paddingBottom: Platform.OS === 'ios' ? 20 : 8,
                paddingTop: 8,
                height: Platform.OS === 'ios' ? 80 : 60,
              },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen name="index"     options={{ title: 'Home' }} />
        <Tabs.Screen name="venues"    options={{ title: 'Venues' }} />
        <Tabs.Screen name="musicians" options={{ title: 'Musicians' }} />
        <Tabs.Screen name="inbox"     options={{ title: 'Inbox' }} />
        <Tabs.Screen name="profile"   options={{ title: profileTabTitle }} />
      </Tabs>
    </View>
  );
}
