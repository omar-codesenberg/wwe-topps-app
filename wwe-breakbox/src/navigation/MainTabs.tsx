import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStack } from './EventsStack';
import { MyPurchasesScreen } from '../screens/purchases/MyPurchasesScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { theme } from '../constants/theme';

export type MainTabParamList = {
  Events: undefined;
  MyPurchases: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.hairline,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: theme.colors.redBright,
        tabBarInactiveTintColor: theme.colors.textDimmed,
        tabBarLabelStyle: { fontSize: 10, letterSpacing: 1, fontFamily: theme.fonts.heading },
      }}
    >
      <Tab.Screen
        name="Events"
        component={EventsStack}
        options={{
          tabBarLabel: 'EVENTS',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏟</Text>,
        }}
      />
      <Tab.Screen
        name="MyPurchases"
        component={MyPurchasesScreen}
        options={{
          tabBarLabel: 'MY SPOTS',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🎴</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'PROFILE',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
