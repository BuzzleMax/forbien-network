import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import * as auth from '../services/auth';
import { useApp } from '../context/AppContext';

export function LoginScreen({ navigation }) {
  const { setSessionUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const onSubmit = async () => {
    setErr('');
    const res = await auth.signIn(email, password);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setSessionUser(res.user);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.brand}>ForBien</Text>
      <Text style={styles.tag}>Pro UPI · Secure field comms</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@agency.gov"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <Pressable onPress={onSubmit} style={styles.primary}>
          <Text style={styles.primaryText}>Sign in</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => navigation.navigate('SignUp')} style={styles.link}>
        <Text style={styles.linkText}>Create account</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Reclaim')} style={styles.link}>
        <Text style={styles.linkText}>Reclaim existing account</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgDeep,
    paddingTop: 72,
    paddingHorizontal: 22,
  },
  brand: { color: colors.silver, fontSize: 34, fontWeight: '900' },
  tag: { color: colors.silverDim, marginTop: 8, fontSize: 14 },
  card: {
    marginTop: 36,
    backgroundColor: colors.bgPanel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  label: { color: colors.silverBlue, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.silver,
    marginBottom: 14,
  },
  err: { color: colors.emergencyGlow, marginBottom: 10, fontSize: 13 },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryText: { color: colors.silver, fontWeight: '800', fontSize: 16 },
  link: { marginTop: 18, alignItems: 'center' },
  linkText: { color: colors.accentMuted, fontWeight: '600', fontSize: 14 },
});
