import { View, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider, useTheme } from '@/lib/theme-context';
import WebHeader from '@/components/WebHeader';

const isWeb = Platform.OS === 'web';

function AppShell() {
  const { isDark } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      {isWeb && <WebHeader />}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="venue/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="musician/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="edit-venue" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="enquire" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="login" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
