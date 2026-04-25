import React from 'react';
import { TouchableOpacity, Text, Alert } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStack } from './EventsStack';
import { MyPurchasesScreen } from '../screens/purchases/MyPurchasesScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { signOut } from '../services/auth.service';
import { useAuthStore } from '../store/authStore';
import { theme } from '../constants/theme';

export type MainTabParamList = {
  Events: undefined;
  MyPurchases: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch {
              // auth store listener handles state reset
            }
          },
        },
      ]
    );
  };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#141414',
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: theme.colors.red,
        tabBarInactiveTintColor: theme.colors.textDimmed,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
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
          title: 'MY PURCHASES',
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTitleStyle: { color: theme.colors.textPrimary, fontWeight: '900', letterSpacing: 2 },
          headerRight: () => (
            <TouchableOpacity onPress={handleSignOut} style={{ marginRight: 16 }}>
              <Text style={{ color: theme.colors.red, fontSize: 13, fontWeight: '700' }}>
                SIGN OUT
              </Text>
            </TouchableOpacity>
          ),
          tabBarLabel: 'MY SPOTS',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🎴</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'PROFILE',
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTitleStyle: { color: theme.colors.textPrimary, fontWeight: '900', letterSpacing: 2 },
          tabBarLabel: 'PROFILE',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
