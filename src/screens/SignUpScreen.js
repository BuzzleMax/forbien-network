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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import * as auth from '../services/auth';
import { useApp } from '../context/AppContext';

export function SignUpScreen({ navigation }) {
  const { setSessionUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [err, setErr] = useState('');

  const onSubmit = async () => {
    setErr('');
    const res = await auth.signUp(email, password, nationalId);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    
    // Save session to AsyncStorage for persistent login
    if (res.user) {
      try {
        await AsyncStorage.setItem('forbien_session', JSON.stringify({
          userId: res.user.id,
          email: res.user.email,
          nationalId: nationalId,
          createdAt: Date.now(),
        }));
      } catch (error) {
        console.error('Failed to save session to AsyncStorage:', error);
      }
    }
    
    setSessionUser(res.user);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>
      <Text style={styles.head}>Create account</Text>
      <Text style={styles.sub}>New identity for ForBien field operations.</Text>

      <View style={styles.card}>
        <Text style={styles.label}>National ID</Text>
        <TextInput
          value={nationalId}
          onChangeText={setNationalId}
          autoCapitalize="characters"
          placeholder="Government ID Number"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
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
        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Strong passphrase"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <Pressable onPress={onSubmit} style={styles.primary}>
          <Text style={styles.primaryText}>Sign up</Text>
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
  backText: { color: colors.neonRed, fontWeight: '700' },
  head: { color: colors.silver, fontSize: 28, fontWeight: '900', letterSpacing: 0.5 },
  sub: { color: colors.silverDim, marginTop: 8, fontSize: 14 },
  card: {
    marginTop: 28,
    backgroundColor: colors.bgPanel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  label: { color: colors.neonRed, fontSize: 12, fontWeight: '700', marginBottom: 6 },
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
  err: { color: colors.neonRed, marginBottom: 10, fontSize: 13 },
  primary: {
    backgroundColor: colors.neonRed,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryText: { color: colors.silver, fontWeight: '800', fontSize: 16 },
});
