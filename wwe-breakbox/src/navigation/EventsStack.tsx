import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Slot } from '../types/slot.types';
import { EventsListScreen } from '../screens/events/EventsListScreen';
import { EventDetailScreen } from '../screens/events/EventDetailScreen';
import { SlotsRosterScreen } from '../screens/events/SlotsRosterScreen';
import { CheckoutScreen } from '../screens/events/CheckoutScreen';
import { PurchaseSuccessScreen } from '../screens/events/PurchaseSuccessScreen';
import { theme } from '../constants/theme';

export type EventsStackParamList = {
  EventsList: undefined;
  EventDetail: { eventId: string };
  SlotsRoster: { eventId: string };
  Checkout: { eventId: string; slotId: string; lockedUntil: string; slotData: Slot };
  PurchaseSuccess: { purchaseId: string; slotData: Slot; eventTitle: string };
};

const Stack = createNativeStackNavigator<EventsStackParamList>();

export function EventsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { color: theme.colors.red, fontWeight: '900', letterSpacing: 3, fontFamily: 'Oswald_700Bold', fontSize: 16 },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="EventsList" component={EventsListScreen} options={{ title: 'BREAKBOX WWE', headerShown: false }} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: 'EVENT DETAILS' }} />
      <Stack.Screen name="SlotsRoster" component={SlotsRosterScreen} options={{ title: 'THE ROSTER' }} />
      <Stack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{ title: 'CHECKOUT', presentation: 'modal' }}
      />
      <Stack.Screen
        name="PurchaseSuccess"
        component={PurchaseSuccessScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
