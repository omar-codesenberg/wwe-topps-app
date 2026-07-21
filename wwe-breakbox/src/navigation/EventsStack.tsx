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
  PurchaseSuccess: { purchaseId: string; slotData: Slot; eventTitle: string; eventId: string };
};

const Stack = createNativeStackNavigator<EventsStackParamList>();

export function EventsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="EventsList" component={EventsListScreen} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      <Stack.Screen name="SlotsRoster" component={SlotsRosterScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="PurchaseSuccess"
        component={PurchaseSuccessScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
