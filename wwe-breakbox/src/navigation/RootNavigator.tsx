import React from 'react';
import { useAuthStore } from '../store/authStore';
import { useAuth } from '../hooks/useAuth';
import { useActiveLockRecovery } from '../hooks/useActiveLockRecovery';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { LoadingSplash } from '../components/ui/LoadingSplash';

export function RootNavigator() {
  useAuth();
  useActiveLockRecovery();
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingSplash />;
  }

  return user ? <MainTabs /> : <AuthStack />;
}
