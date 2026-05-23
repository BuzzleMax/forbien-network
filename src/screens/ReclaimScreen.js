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

export function ReclaimScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  const onSubmit = async () => {
    setErr('');
    setSent(false);
    const res = await auth.reclaimAccount(email);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setSent(true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>
      <Text style={styles.head}>Reclaim account</Text>
      <Text style={styles.sub}>
        Enter your account email and we will send a secure password reset link.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@unit.gov"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        {sent ? (
          <Text style={styles.ok}>
            Reset link sent. Check your inbox and follow the secure recovery flow.
          </Text>
        ) : null}
        <Pressable onPress={onSubmit} style={styles.primary}>
          <Text style={styles.primaryText}>Send reset link</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgDeep,
    paddingTop: 56,
    paddingHorizontal: 22,
  },
  back: { marginBottom: 12, alignSelf: 'flex-start' },
  backText: { color: colors.silverBlue, fontWeight: '700' },
  head: { color: colors.silver, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.silverDim, marginTop: 8, fontSize: 14, lineHeight: 20 },
  card: {
    marginTop: 20,
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
  ok: { color: colors.success, marginBottom: 10, fontSize: 13, lineHeight: 18 },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryText: { color: colors.silver, fontWeight: '800', fontSize: 16 },
});
