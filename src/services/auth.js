import { supabase } from '../lib/supabase';

function normalizeError(error, fallback) {
  return error?.message || fallback;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.user || null;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: normalizeError(error, 'Failed to sign out.') };
  return { ok: true };
}

export async function signIn(email, password) {
  const e = (email || '').trim().toLowerCase();
  if (!e || !password) {
    return { ok: false, error: 'Email and password required.' };
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e,
    password,
  });
  if (error || !data.user) {
    return { ok: false, error: normalizeError(error, 'Invalid email or password.') };
  }
  return { ok: true, user: data.user };
}

export async function signUp(email, password, nationalId = null) {
  const e = (email || '').trim().toLowerCase();
  if (!e || !password) {
    return { ok: false, error: 'Email and password required.' };
  }
  
  // Check for national ID uniqueness if provided
  if (nationalId) {
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles')
      .select('national_id')
      .eq('national_id', nationalId)
      .maybeSingle();
    
    if (profileError) {
      return { ok: false, error: normalizeError(profileError, 'Failed to check national ID.') };
    }
    
    if (existingProfile) {
      return { ok: false, error: 'National ID already registered. Please use a different ID or contact support.' };
    }
  }
  
  const { data, error } = await supabase.auth.signUp({
    email: e,
    password,
    options: {
      data: {
        national_id: nationalId,
      },
    },
  });
  
  if (error) {
    return { ok: false, error: normalizeError(error, 'Could not create account.') };
  }
  
  // Create profile with national ID as primary identifier
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: data.user.id,
        email: e,
        national_id: nationalId,
        created_at: new Date().toISOString(),
      });
    
    if (profileError) {
      console.error('Failed to create profile:', profileError);
      // Continue anyway as auth was successful
    }
  }
  
  return { ok: true, user: data.user || null };
}

export async function reclaimAccount(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) {
    return { ok: false, error: 'Email is required.' };
  }
  const { error } = await supabase.auth.resetPasswordForEmail(e);
  if (error) {
    return { ok: false, error: normalizeError(error, 'Failed to send reset email.') };
  }
  return { ok: true };
}

export async function fetchProfile(userId) {
  if (!userId) return { ok: false, error: 'Missing user id.' };
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: normalizeError(error, 'Failed to load profile.') };
  }
  return { ok: true, profile: data || null };
}
