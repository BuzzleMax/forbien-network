import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as mesh from '../api/meshLogic';

const SYSTEM_KEY = 'forbien_system_ok';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [systemCheckPassed, setSystemCheckPassed] = useState(false);
  const [isMeshMode, setIsMeshMode] = useState(true);
  const [missionGroupId, setMissionGroupId] = useState(null);
  const [emergencyPriority, setEmergencyPriority] = useState('auto');
  const [userRole, setUserRole] = useState('regular'); // 'regular', 'HQ', or 'Headquarters'
  const [nodeRole, setNodeRoleState] = useState(mesh.NODE_ROLES?.FIELD || 'FIELD');
  const [nodeId, setNodeId] = useState(mesh.getLocalNodeId?.() || 'NODE-LOCAL');
  const [hqAlerts, setHqAlerts] = useState([]);
  const [hqClearanceLevel, setHqClearanceLevel] = useState('district'); // 'district', 'state', 'national'
  const [districtLog, setDistrictLog] = useState([]);
  const [stateLog, setStateLog] = useState([]);
  const [nationalLog, setNationalLog] = useState([]);
  const [peripheralSupported, setPeripheralSupported] = useState(null); // null = unknown, true/false

  const refreshBootstrap = useCallback(async () => {
    const sys = await AsyncStorage.getItem(SYSTEM_KEY);
    setSystemCheckPassed(sys === 'true');
    setBootstrapDone(true);
  }, []);

  useEffect(() => {
    refreshBootstrap();
    mesh.loadNodeIdentity().then((id) => {
      setNodeId(id);
      setNodeRoleState(mesh.getNodeRole());
    });

    // Check peripheral support on app startup
    mesh.checkPeripheralSupport().then((supported) => {
      setPeripheralSupported(supported);
    });

    const unsub = mesh.onPeerEvent((event, payload) => {
      if (event === 'hq_delivery') {
        setHqAlerts((prev) => {
          if (prev.some((a) => a.id === payload.id)) return prev;
          return [payload, ...prev];
        });
      } else if (event === 'role_changed') {
        setNodeRoleState(payload.role);
        setNodeId(payload.nodeId);
      } else if (event === 'mesh_state') {
        // Update peripheral support from mesh state events
        if (payload.peripheralSupported !== undefined) {
          setPeripheralSupported(payload.peripheralSupported);
        }
      }
    });

    return unsub;
  }, [refreshBootstrap]);

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

  const updateNodeRole = useCallback(async (newRole) => {
    const res = await mesh.setNodeRole(newRole);
    if (res.ok) {
      setNodeRoleState(res.role);
      setNodeId(res.nodeId);
    }
  }, []);

  const completeSystemCheck = useCallback(async () => {
    await AsyncStorage.setItem(SYSTEM_KEY, 'true');
    setSystemCheckPassed(true);
  }, []);

  const createGroup = useCallback((name) => {
    return `m_${Date.now()}`;
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
      loggedBy: 'device_local',
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
  }, [hqClearanceLevel]);

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
      nodeRole,
      setNodeRole: updateNodeRole,
      nodeId,
      hqAlerts,
      setHqAlerts,
      hqClearanceLevel,
      setHqClearanceLevel,
      districtLog,
      stateLog,
      nationalLog,
      logTacticalPacket,
      clearLogs,
      getAccessibleLogs,
      createGroup,
      refreshBootstrap,
      peripheralSupported,
    }),
    [
      bootstrapDone,
      systemCheckPassed,
      completeSystemCheck,
      isMeshMode,
      missionGroupId,
      emergencyPriority,
      userRole,
      nodeRole,
      updateNodeRole,
      nodeId,
      hqAlerts,
      hqClearanceLevel,
      districtLog,
      stateLog,
      nationalLog,
      logTacticalPacket,
      clearLogs,
      getAccessibleLogs,
      createGroup,
      refreshBootstrap,
      peripheralSupported,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
