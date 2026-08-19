import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Colors } from '@/constants/colors';

function TabIcon({ focused, activeIcon, inactiveIcon }: {
  focused: boolean;
  activeIcon: string;
  inactiveIcon: string;
}) {
  const { Text } = require('react-native');
  return (
    <Text style={{ fontSize: 22 }}>{focused ? activeIcon : inactiveIcon}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.orange,
        tabBarInactiveTintColor: Colors.greyLight,
        tabBarStyle: {
          backgroundColor: Colors.bg,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 20 : 8,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 80 : 60,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeIcon="🏠" inactiveIcon="🏠" />
          ),
        }}
      />
      <Tabs.Screen
        name="venues"
        options={{
          title: 'Venues',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeIcon="🎪" inactiveIcon="🎪" />
          ),
        }}
      />
      <Tabs.Screen
        name="musicians"
        options={{
          title: 'Musicians',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeIcon="🎸" inactiveIcon="🎸" />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeIcon="💬" inactiveIcon="💬" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeIcon="👤" inactiveIcon="👤" />
          ),
        }}
      />
    </Tabs>
  );
}
