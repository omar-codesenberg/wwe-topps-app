import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { signUp } from '../../services/auth.service';
import { WWEButton } from '../../components/ui/WWEButton';
import { GlassCard } from '../../components/ui/GlassCard';
import { useToastStore } from '../../store/toastStore';
import { theme } from '../../constants/theme';
import { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToastStore();

  const handleRegister = async () => {
    if (!displayName.trim() || !email.trim() || !password.trim()) {
      show('Please fill in all fields', 'error');
      return;
    }
    if (password.length < 6) {
      show('Password must be at least 6 characters', 'error');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, displayName.trim());
    } catch (error: any) {
      const msg =
        error.code === 'auth/email-already-in-use'
          ? 'An account with this email already exists'
          : error.code === 'auth/invalid-email'
          ? 'Please enter a valid email address'
          : error.code === 'auth/weak-password'
          ? 'Password is too weak'
          : 'Registration failed. Please try again.';
      show(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brand}>BREAKBOX</Text>
          <Text style={styles.brandWwe}>WWE</Text>
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.title}>CREATE ACCOUNT</Text>

          <TextInput
            style={styles.input}
            placeholder="Display Name"
            placeholderTextColor={theme.colors.textDimmed}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.colors.textDimmed}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (min 6 characters)"
            placeholderTextColor={theme.colors.textDimmed}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <WWEButton
            label="Join the Arena"
            onPress={handleRegister}
            loading={loading}
            style={styles.button}
          />

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.link}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkHighlight}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
  header: { alignItems: 'center', marginBottom: theme.spacing.xl },
  brand: { color: theme.colors.textPrimary, fontSize: 36, fontWeight: '900', letterSpacing: 4, fontFamily: 'Oswald_700Bold' },
  brandWwe: { color: theme.colors.red, fontSize: 52, fontWeight: '900', letterSpacing: 8, marginTop: -8, fontFamily: 'Oswald_700Bold' },
  card: { padding: theme.spacing.lg },
  title: {
    color: theme.colors.gold,
    fontSize: theme.sizes.md,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    fontFamily: 'Oswald_700Bold',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    borderRadius: theme.radius.sm,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    fontSize: theme.sizes.sm,
    marginBottom: theme.spacing.sm,
  },
  button: { marginTop: theme.spacing.md },
  link: { marginTop: theme.spacing.md, alignItems: 'center' },
  linkText: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm },
  linkHighlight: { color: theme.colors.red, fontWeight: '700' },
});
