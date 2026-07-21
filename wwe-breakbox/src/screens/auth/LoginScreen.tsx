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
import { signIn } from '../../services/auth.service';
import { WWEButton } from '../../components/ui/WWEButton';
import { GlassCard } from '../../components/ui/GlassCard';
import { WCCLogo } from '../../components/ui/WCCLogo';
import { StageBackground } from '../../components/ui/StageBackground';
import { useToastStore } from '../../store/toastStore';
import { theme } from '../../constants/theme';
import { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToastStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      show('Please enter email and password', 'error');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      const msg =
        error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password'
          ? 'Invalid email or password'
          : error.code === 'auth/user-not-found'
          ? 'No account found with this email'
          : error.code === 'auth/too-many-requests'
          ? 'Too many attempts. Try again later.'
          : 'Sign in failed. Please try again.';
      show(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StageBackground animateIn>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <WCCLogo width={260} />
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.title}>SIGN IN</Text>

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
            placeholder="Password"
            placeholderTextColor={theme.colors.textDimmed}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <WWEButton
            label="ENTER THE ARENA"
            onPress={handleLogin}
            loading={loading}
            style={styles.button}
          />

          <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.link}>
            <Text style={styles.linkText}>
              New here? <Text style={styles.linkHighlight}>Create Account</Text>
            </Text>
          </TouchableOpacity>
        </GlassCard>
      </ScrollView>
      </KeyboardAvoidingView>
    </StageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
  header: { alignItems: 'center', marginBottom: theme.spacing.xl },
  card: { padding: theme.spacing.lg },
  title: {
    color: theme.colors.gold,
    fontSize: theme.sizes.md,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    fontFamily: theme.fonts.display,
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
