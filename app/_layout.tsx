import { View, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth-context';
import WebHeader from '@/components/WebHeader';

const isWeb = Platform.OS === 'web';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
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
        </View>
        <StatusBar style="dark" />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
