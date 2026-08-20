import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LightColors, DarkColors, type ThemeColors } from '@/constants/colors';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  colors:       ThemeColors;
  isDark:       boolean;
  themeMode:    ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleDark:   () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors:       LightColors,
  isDark:       false,
  themeMode:    'system',
  setThemeMode: async () => {},
  toggleDark:   () => {},
});

const STORAGE_KEY = '@gigmatch_theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme            = useColorScheme();
  const [themeMode, setMode]    = useState<ThemeMode>('light');
  const [ready, setReady]       = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setMode(val);
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  async function setThemeMode(mode: ThemeMode) {
    setMode(mode);
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  }

  const isDark =
    themeMode === 'dark' ||
    (themeMode === 'system' && systemScheme === 'dark');

  const colors = isDark ? DarkColors : LightColors;

  function toggleDark() {
    setThemeMode(isDark ? 'light' : 'dark');
  }

  // Avoid flash of wrong theme on first render
  if (!ready) return null;

  return (
    <ThemeContext.Provider value={{ colors, isDark, themeMode, setThemeMode, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
