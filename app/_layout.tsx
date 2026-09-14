import { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider, useTheme } from '@/lib/theme-context';
SplashScreen.preventAutoHideAsync();

const isWeb = Platform.OS === 'web';

function AppShell() {
  const { isDark } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="venue/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="musician/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="edit-venue" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="enquire" options={{ headerShown: false, presentation: isWeb ? 'transparentModal' : 'formSheet', animation: isWeb ? 'fade' : 'slide_from_bottom', contentStyle: isWeb ? { backgroundColor: 'transparent' } : undefined }} />
        <Stack.Screen name="messages/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="sub-thread" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.ttf'),
    'Satoshi-Medium':  require('../assets/fonts/Satoshi-Medium.ttf'),
    'Satoshi-Bold':    require('../assets/fonts/Satoshi-Bold.ttf'),
    'Satoshi-Black':   require('../assets/fonts/Satoshi-Black.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

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
