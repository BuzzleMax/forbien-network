import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as mesh from '../api/meshLogic';
import * as auth from '../services/auth';
import { supabase } from '../lib/supabase';

const SYSTEM_KEY = 'forbien_system_ok';
const SYNC_THROTTLE_MS = 30000; // 30-second throttling for battery preservation

const AppContext = createContext(null);

const SEED_FRIENDS = [
  { id: 'f1', name: 'Asha K.', handle: '@asha', online: true },
  { id: 'f2', name: 'Ravi M.', handle: '@ravi', online: true },
  { id: 'f3', name: 'Unit North', handle: '@unit_n', online: false },
];

const SEED_GROUPS = [
  { id: 'g_patrol', name: 'Patrol Delta', members: 12 },
  { id: 'g_ops', name: 'Ops Brief', members: 6 },
];

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [systemCheckPassed, setSystemCheckPassed] = useState(false);
  const [isMeshMode, setIsMeshMode] = useState(false);
  const [missionGroupId, setMissionGroupId] = useState(null);
  const [emergencyPriority, setEmergencyPriority] = useState('auto');
  const [userRole, setUserRole] = useState('regular'); // 'regular', 'HQ', or 'Headquarters'
  const [hqClearanceLevel, setHqClearanceLevel] = useState('district'); // 'district', 'state', 'national'
  const [districtLog, setDistrictLog] = useState([]);
  const [stateLog, setStateLog] = useState([]);
  const [nationalLog, setNationalLog] = useState([]);
  const [friends, setFriends] = useState(SEED_FRIENDS);
  const [groups, setGroups] = useState(SEED_GROUPS);
  const authSubscriptionRef = useRef(null);
  const lastSupabaseSyncRef = useRef(0);

  const refreshBootstrap = useCallback(async () => {
    const [session, sys] = await Promise.all([
      auth.getSession(),
      AsyncStorage.getItem(SYSTEM_KEY),
    ]);
    setUser(session);
    setSystemCheckPassed(sys === 'true');
    setBootstrapDone(true);
  }, []);

  const refreshProfile = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      return;
    }

    // Check if we should throttle this sync (30-second interval)
    const now = Date.now();
    const timeSinceLastSync = now - lastSupabaseSyncRef.current;
    if (timeSinceLastSync < SYNC_THROTTLE_MS) {
      console.log(`Supabase sync throttled: ${timeSinceLastSync}ms since last sync (minimum ${SYNC_THROTTLE_MS}ms)`);
      return;
    }

    setProfileLoading(true);
    const res = await auth.fetchProfile(uid);
    if (res.ok) setProfile(res.profile);
    else setProfile(null);
    setProfileLoading(false);
    lastSupabaseSyncRef.current = Date.now();
  }, []);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    let mounted = true;
    const bootstrapAuth = async () => {
      const initialUser = await auth.getSession();
      if (!mounted) return;
      setUser(initialUser);
      await refreshProfile(initialUser?.id);
      if (mounted) setBootstrapDone(true);
    };
    bootstrapAuth();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user || null;
      setUser(nextUser);
      refreshProfile(nextUser?.id);
    });
    authSubscriptionRef.current = data.subscription;
    return () => {
      mounted = false;
      authSubscriptionRef.current?.unsubscribe();
      authSubscriptionRef.current = null;
    };
  }, [refreshProfile]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isMeshMode) {
        await mesh.disableMesh();
        return;
      }
      const res = await mesh.enableMesh();
      if (mounted && !res.ok) setIsMeshMode(false);
    })();
    return () => {
      mounted = false;
    };
  }, [isMeshMode]);

  const completeSystemCheck = useCallback(async () => {
    await AsyncStorage.setItem(SYSTEM_KEY, 'true');
    setSystemCheckPassed(true);
  }, []);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setProfile(null);
    setUser(null);
  }, []);

  const setSessionUser = useCallback((u) => setUser(u), []);

  const createGroup = useCallback((name) => {
    const id = `g_${Date.now()}`;
    setGroups((g) => [...g, { id, name, members: 1 }]);
    return id;
  }, []);

  /**
   * Filter and log tactical packet based on HQ clearance level
   * @param {object} packet - Tactical packet to log
   * @param {string} packetLevel - Required clearance level for this packet ('district', 'state', 'national')
   */
  const logTacticalPacket = useCallback((packet, packetLevel = 'district') => {
    const logEntry = {
      ...packet,
      loggedAt: Date.now(),
      packetLevel,
      loggedBy: user?.id || 'unknown',
    };

    // Always log to district level (lowest tier)
    setDistrictLog((prev) => [...prev, logEntry]);

    // Log to state level if clearance allows
    if (hqClearanceLevel === 'state' || hqClearanceLevel === 'national') {
      if (packetLevel === 'district' || packetLevel === 'state') {
        setStateLog((prev) => [...prev, logEntry]);
      }
    }

    // Log to national level only if clearance is national
    if (hqClearanceLevel === 'national') {
      setNationalLog((prev) => [...prev, logEntry]);
    }
  }, [hqClearanceLevel, user?.id]);

  /**
   * Clear logs for a specific tier
   * @param {string} tier - Log tier to clear ('district', 'state', 'national', 'all')
   */
  const clearLogs = useCallback((tier = 'all') => {
    if (tier === 'district' || tier === 'all') {
      setDistrictLog([]);
    }
    if (tier === 'state' || tier === 'all') {
      setStateLog([]);
    }
    if (tier === 'national' || tier === 'all') {
      setNationalLog([]);
    }
  }, []);

  /**
   * Get logs accessible at current clearance level
   * @returns {object} - Object with accessible logs
   */
  const getAccessibleLogs = useCallback(() => {
    const accessible = {
      district: districtLog,
    };

    if (hqClearanceLevel === 'state' || hqClearanceLevel === 'national') {
      accessible.state = stateLog;
    }

    if (hqClearanceLevel === 'national') {
      accessible.national = nationalLog;
    }

    return accessible;
  }, [hqClearanceLevel, districtLog, stateLog, nationalLog]);

  const value = useMemo(
    () => ({
      bootstrapDone,
      user,
      profile,
      profileLoading,
      setSessionUser,
      signOut,
      systemCheckPassed,
      completeSystemCheck,
      isMeshMode,
      setIsMeshMode,
      missionGroupId,
      setMissionGroupId,
      emergencyPriority,
      setEmergencyPriority,
      userRole,
      setUserRole,
      hqClearanceLevel,
      setHqClearanceLevel,
      districtLog,
      stateLog,
      nationalLog,
      logTacticalPacket,
      clearLogs,
      getAccessibleLogs,
      friends,
      setFriends,
      groups,
      createGroup,
      refreshBootstrap,
    }),
    [
      bootstrapDone,
      user,
      profile,
      profileLoading,
      setSessionUser,
      signOut,
      systemCheckPassed,
      completeSystemCheck,
      isMeshMode,
      missionGroupId,
      emergencyPriority,
      userRole,
      hqClearanceLevel,
      districtLog,
      stateLog,
      nationalLog,
      logTacticalPacket,
      clearLogs,
      getAccessibleLogs,
      friends,
      groups,
      createGroup,
      refreshBootstrap,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
