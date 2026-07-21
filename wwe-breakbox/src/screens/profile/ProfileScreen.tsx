import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useNavigation } from '@react-navigation/native';
import { firebaseDb } from '../../config/firebase';
import { useAuthStore } from '../../store/authStore';
import { signOut } from '../../services/auth.service';
import { WWEButton } from '../../components/ui/WWEButton';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { AppHeader } from '../../components/ui/AppHeader';
import { theme } from '../../constants/theme';
import { ShippingAddress } from '../../types/user.types';

interface FormState {
  firstName: string;
  lastName: string;
  username: string;
  wantBaseCards: boolean;
  address: {
    line1: string;
    line2: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  username: '',
  wantBaseCards: true,
  address: { line1: '', line2: '', city: '', province: '', postalCode: '', country: '' },
};

export function ProfileScreen() {
  const { user } = useAuthStore();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState<string>('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(doc(firebaseDb, 'users', user.uid), (snap) => {
      const data = snap.data();
      if (data) {
        const shipping = (data.shippingAddress ?? null) as
          | (Partial<ShippingAddress> & { state?: string })
          | null;
        setEmail(data.email ?? user.email ?? '');
        setForm({
          firstName: data.firstName ?? '',
          lastName: data.lastName ?? '',
          username: data.username ?? '',
          wantBaseCards: data.wantBaseCards ?? true,
          address: {
            line1: shipping?.line1 ?? '',
            line2: shipping?.line2 ?? '',
            city: shipping?.city ?? '',
            province: shipping?.province ?? shipping?.state ?? '',
            postalCode: shipping?.postalCode ?? '',
            country: shipping?.country ?? '',
          },
        });
      }
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const updateAddress = (key: keyof FormState['address'], value: string) => {
    setForm((prev) => ({ ...prev, address: { ...prev.address, [key]: value } }));
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
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
    ]);
  };

  const signOutButton = (
    <TouchableOpacity onPress={handleSignOut} hitSlop={8}>
      <Text style={styles.signOut}>SIGN OUT</Text>
    </TouchableOpacity>
  );

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const shipping: ShippingAddress | null =
        form.address.line1 ||
        form.address.city ||
        form.address.province ||
        form.address.postalCode ||
        form.address.country
          ? {
              line1: form.address.line1,
              line2: form.address.line2 || undefined,
              city: form.address.city,
              province: form.address.province,
              postalCode: form.address.postalCode,
              country: form.address.country,
            }
          : null;

      await updateDoc(doc(firebaseDb, 'users', user.uid), {
        firstName: form.firstName,
        lastName: form.lastName,
        username: form.username,
        wantBaseCards: form.wantBaseCards,
        shippingAddress: shipping,
      });
      navigation.navigate('Events');
    } catch (e: any) {
      console.error('Profile save error:', e);
      Alert.alert('Error', e?.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <AppHeader title="PROFILE" right={signOutButton} />
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.red} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  if (!user) {
    return (
      <ScreenBackground>
        <AppHeader title="PROFILE" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>You must be signed in to view your profile.</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <AppHeader title="PROFILE" right={signOutButton} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <Text style={styles.label}>EMAIL</Text>
        <View style={[styles.input, styles.readOnly]}>
          <Text style={styles.readOnlyText}>{email || '—'}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.section, styles.flex1, { marginRight: theme.spacing.sm }]}>
          <Text style={styles.label}>FIRST NAME</Text>
          <TextInput
            style={styles.input}
            value={form.firstName}
            onChangeText={(v) => setForm((p) => ({ ...p, firstName: v }))}
            placeholder="First name"
            placeholderTextColor={theme.colors.textDimmed}
            autoCapitalize="words"
          />
        </View>
        <View style={[styles.section, styles.flex1]}>
          <Text style={styles.label}>LAST NAME</Text>
          <TextInput
            style={styles.input}
            value={form.lastName}
            onChangeText={(v) => setForm((p) => ({ ...p, lastName: v }))}
            placeholder="Last name"
            placeholderTextColor={theme.colors.textDimmed}
            autoCapitalize="words"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>USERNAME</Text>
        <TextInput
          style={styles.input}
          value={form.username}
          onChangeText={(v) => setForm((p) => ({ ...p, username: v }))}
          placeholder="Username"
          placeholderTextColor={theme.colors.textDimmed}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.sectionHeader}>SHIPPING ADDRESS</Text>

      <View style={styles.section}>
        <Text style={styles.label}>ADDRESS LINE 1</Text>
        <TextInput
          style={styles.input}
          value={form.address.line1}
          onChangeText={(v) => updateAddress('line1', v)}
          placeholder="Street address"
          placeholderTextColor={theme.colors.textDimmed}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>ADDRESS LINE 2</Text>
        <TextInput
          style={styles.input}
          value={form.address.line2}
          onChangeText={(v) => updateAddress('line2', v)}
          placeholder="Apt, suite, unit (optional)"
          placeholderTextColor={theme.colors.textDimmed}
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.section, styles.flex1, { marginRight: theme.spacing.sm }]}>
          <Text style={styles.label}>CITY</Text>
          <TextInput
            style={styles.input}
            value={form.address.city}
            onChangeText={(v) => updateAddress('city', v)}
            placeholder="City"
            placeholderTextColor={theme.colors.textDimmed}
          />
        </View>
        <View style={[styles.section, styles.flex1]}>
          <Text style={styles.label}>PROVINCE</Text>
          <TextInput
            style={styles.input}
            value={form.address.province}
            onChangeText={(v) => updateAddress('province', v)}
            placeholder="Province"
            placeholderTextColor={theme.colors.textDimmed}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.section, styles.flex1, { marginRight: theme.spacing.sm }]}>
          <Text style={styles.label}>POSTAL CODE</Text>
          <TextInput
            style={styles.input}
            value={form.address.postalCode}
            onChangeText={(v) => updateAddress('postalCode', v)}
            placeholder="ZIP / Postal code"
            placeholderTextColor={theme.colors.textDimmed}
          />
        </View>
        <View style={[styles.section, styles.flex1]}>
          <Text style={styles.label}>COUNTRY</Text>
          <TextInput
            style={styles.input}
            value={form.address.country}
            onChangeText={(v) => updateAddress('country', v)}
            placeholder="Country"
            placeholderTextColor={theme.colors.textDimmed}
          />
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.flex1}>
          <Text style={styles.toggleLabel}>DO YOU WANT YOUR BASE CARDS?</Text>
          <Text style={styles.toggleHint}>
            Toggle off to skip receiving base cards from your hits.
          </Text>
        </View>
        <Switch
          value={form.wantBaseCards}
          onValueChange={(v) => setForm((p) => ({ ...p, wantBaseCards: v }))}
          trackColor={{ false: theme.colors.glassBorder, true: theme.colors.red }}
          thumbColor={theme.colors.textPrimary}
        />
      </View>

      <WWEButton
        label="SAVE PROFILE"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        style={styles.saveButton}
      />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl * 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  errorText: { color: theme.colors.textSecondary, textAlign: 'center' },
  signOut: { color: theme.colors.redBright, fontSize: theme.sizes.xs, letterSpacing: 1.5, fontFamily: theme.fonts.heading },
  sectionHeader: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 3,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  section: { marginBottom: theme.spacing.md },
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  label: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.glassBg,
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.sm,
    minHeight: 44,
  },
  readOnly: {
    justifyContent: 'center',
    opacity: 0.8,
  },
  readOnlyText: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.glassBorder,
    marginVertical: theme.spacing.md,
  },
  toggleLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  toggleHint: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    marginTop: 4,
  },
  saveButton: { marginTop: theme.spacing.lg },
});
