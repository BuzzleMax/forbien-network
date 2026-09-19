/**
 * Emergency Multi-Gateway Delivery System
 * 
 * Manages independent emergency delivery through multiple gateways:
 * - BLE Mesh (offline, store-and-forward)
 * - SMS (cellular, Android SMS API)
 * - Emergency Call (Android dialer)
 * 
 * Each gateway tracks its own state independently.
 * All gateways share a canonical SOS event ID.
 */

let Platform = { OS: 'node', Version: 0 };
let PermissionsAndroid = null;
let Linking = null;

try {
  const RN = require('react-native');
  Platform = RN.Platform;
  PermissionsAndroid = RN.PermissionsAndroid;
  Linking = RN.Linking;
} catch (e) {
  // Running in Node / unit test environment
}

let AsyncStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default || AsyncStorage;
} catch {}

// Gateway types
export const GATEWAY_TYPES = {
  BLE: 'BLE',
  SMS: 'SMS',
  CALL: 'CALL',
};

// Gateway states
export const GATEWAY_STATES = {
  // BLE Gateway States
  BLE_QUEUED: 'BLE_QUEUED',
  BLE_RELAYING: 'BLE_RELAYING',
  BLE_DELIVERED_TO_HQ: 'BLE_DELIVERED_TO_HQ',
  BLE_FAILED: 'BLE_FAILED',
  
  // SMS Gateway States
  SMS_NOT_AVAILABLE: 'SMS_NOT_AVAILABLE',
  SMS_READY: 'SMS_READY',
  SMS_HANDED_TO_SMS_APP: 'SMS_HANDED_TO_SMS_APP',
  SMS_SENT: 'SMS_SENT',
  SMS_FAILED: 'SMS_FAILED',
  
  // CALL Gateway States
  CALL_AVAILABLE: 'CALL_AVAILABLE',
  CALL_DIALER_OPENED: 'CALL_DIALER_OPENED',
  CALL_INITIATED: 'CALL_INITIATED',
  CALL_FAILED: 'CALL_FAILED',
};

// Canonical SOS event ID format: SOS-XXXXXXXX (8-char hex)
function generateCanonicalSOSId() {
  const timestamp = Date.now().toString(16).toUpperCase();
  const random = Math.floor(Math.random() * 0x10000).toString(16).toUpperCase();
  return `SOS-${timestamp.slice(-4)}${random.slice(-4)}`;
}

/**
 * Gateway Manager Class
 */
class EmergencyGatewayManager {
  constructor() {
    this.activeSOS = null; // Current active SOS event
    this.gatewayStates = new Map(); // gatewayType -> state
    this.gatewayCapabilities = new Map(); // gatewayType -> boolean
    this.listeners = new Set();
    this.duplicatePreventionCache = new Map(); // canonicalId -> timestamp
    this.DUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize gateway capabilities
   */
  async initialize() {
    if (Platform.OS === 'android') {
      // Check SMS capability
      this.gatewayCapabilities.set(GATEWAY_TYPES.SMS, await this.checkSMSCapability());
      
      // Check Call capability
      this.gatewayCapabilities.set(GATEWAY_TYPES.CALL, await this.checkCallCapability());
      
      // BLE capability is checked by mesh system
      this.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true); // Assume BLE available initially
    } else {
      // Non-Android platforms - assume SMS/call not available
      this.gatewayCapabilities.set(GATEWAY_TYPES.SMS, false);
      this.gatewayCapabilities.set(GATEWAY_TYPES.CALL, false);
      this.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
    }
    
    // Load duplicate prevention cache
    await this.loadDuplicateCache();
  }

  /**
   * TEST ONLY: Override AsyncStorage for testing
   * This should never be called in production
   */
  _TEST_setAsyncStorage(mockStorage) {
    AsyncStorage = mockStorage;
  }

  /**
   * Check SMS capability
   */
  async checkSMSCapability() {
    if (Platform.OS !== 'android') return false;
    
    try {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        return granted;
      }
      return true; // Older Android versions
    } catch (e) {
      console.warn('SMS capability check failed:', e.message);
      return false;
    }
  }

  /**
   * Check Call capability
   */
  async checkCallCapability() {
    if (Platform.OS !== 'android') return false;
    
    try {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
        return granted;
      }
      return true; // Older Android versions
    } catch (e) {
      console.warn('Call capability check failed:', e.message);
      return false;
    }
  }

  /**
   * Create new SOS event
   */
  async createSOS(emergencyData) {
    const canonicalId = generateCanonicalSOSId();
    
    // Check for duplicate SOS - check if canonical ID exists at all, not just within TTL
    if (this.hasCanonicalIdInCache(canonicalId)) {
      return {
        ok: false,
        error: 'Duplicate SOS detected',
        canonicalId: null,
      };
    }
    
    // Check if there's an active SOS with a different ID (single active SOS at a time)
    if (this.activeSOS) {
      const elapsed = Date.now() - this.activeSOS.timestamp;
      if (elapsed < this.DUP_CACHE_TTL_MS) {
        return {
          ok: false,
          error: 'Active SOS already exists',
          canonicalId: null,
        };
      }
    }
    
    this.activeSOS = {
      canonicalId,
      timestamp: Date.now(),
      emergencyData,
      gatewayStates: {
        [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
        [GATEWAY_TYPES.SMS]: this.gatewayCapabilities.get(GATEWAY_TYPES.SMS) 
          ? GATEWAY_STATES.SMS_READY 
          : GATEWAY_STATES.SMS_NOT_AVAILABLE,
        [GATEWAY_TYPES.CALL]: this.gatewayCapabilities.get(GATEWAY_TYPES.CALL)
          ? GATEWAY_STATES.CALL_AVAILABLE
          : GATEWAY_STATES.CALL_FAILED,
      },
      location: emergencyData.location || null,
    };
    
    // Add to duplicate prevention cache
    this.duplicatePreventionCache.set(canonicalId, Date.now());
    await this.saveDuplicateCache();
    
    // Notify listeners
    this.notifyListeners('sos_created', { canonicalId, gatewayStates: this.activeSOS.gatewayStates });
    
    return {
      ok: true,
      canonicalId,
      gatewayStates: this.activeSOS.gatewayStates,
    };
  }

  /**
   * Check for duplicate SOS
   */
  isDuplicateSOS(canonicalId) {
    const lastTimestamp = this.duplicatePreventionCache.get(canonicalId);
    if (!lastTimestamp) return false;
    
    const elapsed = Date.now() - lastTimestamp;
    return elapsed < this.DUP_CACHE_TTL_MS;
  }

  /**
   * Check if a canonical ID exists in the cache regardless of TTL
   */
  hasCanonicalIdInCache(canonicalId) {
    return this.duplicatePreventionCache.has(canonicalId);
  }

  /**
   * Update gateway state
   */
  async updateGatewayState(gatewayType, newState, metadata = {}) {
    if (!this.activeSOS) {
      console.warn('No active SOS to update');
      return;
    }
    
    const oldState = this.activeSOS.gatewayStates[gatewayType];
    this.activeSOS.gatewayStates[gatewayType] = newState;
    
    // Save persistent state
    await this.saveSOSState();
    
    // Notify listeners
    this.notifyListeners('gateway_state_changed', {
      gatewayType,
      oldState,
      newState,
      canonicalId: this.activeSOS.canonicalId,
      metadata,
    });
  }

  /**
   * BLE Gateway: Process through offline mesh
   * Note: This method only updates state. The actual BLE processing is handled by meshLogic.js
   * which should call back to update the gateway state.
   */
  async processBLEGateway() {
    if (!this.activeSOS) return;
    
    try {
      await this.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_RELAYING);
      
      // The actual BLE mesh processing is handled by meshLogic.js
      // This is just the state management layer
      // The mesh system will call back with delivery status via updateGatewayState
      
      // Return the canonical ID for the mesh system to use
      return {
        ok: true,
        canonicalId: this.activeSOS.canonicalId,
        emergencyData: this.activeSOS.emergencyData,
      };
      
    } catch (error) {
      console.error('BLE gateway processing failed:', error);
      await this.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_FAILED, {
        error: error.message,
      });
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  /**
   * SMS Gateway: Send via Android SMS
   */
  async processSMSGateway(phoneNumber, message) {
    if (!this.activeSOS) return;
    
    if (!this.gatewayCapabilities.get(GATEWAY_TYPES.SMS)) {
      await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_NOT_AVAILABLE);
      return;
    }
    
    try {
      await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_READY);
      
      // Request SMS permission if needed
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_FAILED, {
            error: 'SMS permission denied',
          });
          return;
        }
      }
      
      // REAL SMS HANDLING - No fake success
      // Try to use react-native-sms if available, otherwise use Linking fallback
      let SmsManager;
      try {
        SmsManager = require('react-native-sms').default;
      } catch (e) {
        // SMS library not available, use Linking as fallback
        console.warn('react-native-sms not available, using Linking fallback');
        
        // Use Linking to open SMS app with pre-filled message
        const url = `sms:${phoneNumber}?body=${encodeURIComponent(message)}`;
        const canOpen = await Linking.canOpenURL(url);
        
        if (canOpen) {
          await Linking.openURL(url);
          await this.updateGatewayState(GATEWAY_STATES.SMS, GATEWAY_STATES.SMS_HANDED_TO_SMS_APP, {
            phoneNumber,
            method: 'linking',
          });
        } else {
          await this.updateGatewayState(GATEWAY_STATES.SMS, GATEWAY_STATES.SMS_FAILED, {
            error: 'Cannot open SMS app',
          });
        }
        return;
      }
      
      // Use react-native-sms if available
      const smsResult = await SmsManager.sendSMS({
        body: message,
        recipients: [phoneNumber],
        successTypes: ['sent', 'delivered'],
      });
      
      // Update state based on actual Android response
      if (smsResult && smsResult.result === 'success') {
        await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_HANDED_TO_SMS_APP, {
          phoneNumber,
          messageId: smsResult.messageId,
        });
      } else {
        await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_FAILED, {
          error: smsResult?.error || 'SMS failed',
        });
      }
      
    } catch (error) {
      console.error('SMS gateway processing failed:', error);
      
      // Check if it's a permission error
      if (error.message && error.message.includes('permission')) {
        await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_FAILED, {
          error: 'SMS permission denied',
        });
      } else {
        await this.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_FAILED, {
          error: error.message,
        });
      }
    }
  }

  /**
   * CALL Gateway: Initiate emergency call
   */
  async processCallGateway(phoneNumber) {
    if (!this.activeSOS) return;
    
    if (!this.gatewayCapabilities.get(GATEWAY_TYPES.CALL)) {
      await this.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_FAILED);
      return;
    }
    
    try {
      await this.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_AVAILABLE);
      
      // REAL CALL HANDLING - No fake success
      // Use Android's Linking API to open the dialer
      const url = `tel:${phoneNumber}`;
      
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        await this.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_FAILED, {
          error: 'Cannot open dialer',
        });
        return;
      }
      
      await this.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_DIALER_OPENED, {
        phoneNumber,
      });
      
      // This will open Android's dialer with the number
      // The user must confirm the call - we cannot bypass this
      await Linking.openURL(url);
      
      // Note: We cannot reliably detect if the call was actually completed
      // The OS handles the actual call and we just opened the dialer
      // So we stop at DIALER_OPENED state
      
    } catch (error) {
      console.error('Call gateway processing failed:', error);
      await this.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_FAILED, {
        error: error.message,
      });
    }
  }

  /**
   * Get current SOS status
   */
  getSOSStatus() {
    if (!this.activeSOS) {
      return {
        active: false,
        canonicalId: null,
        gatewayStates: {},
      };
    }
    
    return {
      active: true,
      canonicalId: this.activeSOS.canonicalId,
      timestamp: this.activeSOS.timestamp,
      gatewayStates: this.activeSOS.gatewayStates,
      location: this.activeSOS.location,
      emergencyData: this.activeSOS.emergencyData,
    };
  }

  /**
   * Clear current SOS
   */
  async clearSOS() {
    if (this.activeSOS) {
      const canonicalId = this.activeSOS.canonicalId;
      this.activeSOS = null;
      await this.saveSOSState();
      this.notifyListeners('sos_cleared', { canonicalId });
    }
  }

  /**
   * Add event listener
   */
  onGatewayEvent(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (e) {
        console.error('Gateway event listener error:', e);
      }
    }
  }

  /**
   * Save SOS state to AsyncStorage
   */
  async saveSOSState() {
    try {
      if (this.activeSOS) {
        await AsyncStorage.setItem('emergency_sos_state', JSON.stringify(this.activeSOS));
      } else {
        await AsyncStorage.removeItem('emergency_sos_state');
      }
    } catch (e) {
      console.warn('Failed to save SOS state:', e.message);
    }
  }

  /**
   * Load SOS state from AsyncStorage
   */
  async loadSOSState() {
    try {
      const saved = await AsyncStorage.getItem('emergency_sos_state');
      if (saved) {
        this.activeSOS = JSON.parse(saved);
        this.notifyListeners('sos_loaded', { canonicalId: this.activeSOS.canonicalId });
      }
    } catch (e) {
      console.warn('Failed to load SOS state:', e.message);
    }
  }

  /**
   * Save duplicate prevention cache
   */
  async saveDuplicateCache() {
    try {
      const cache = Array.from(this.duplicatePreventionCache.entries());
      await AsyncStorage.setItem('emergency_dup_cache', JSON.stringify(cache));
    } catch (e) {
      console.warn('Failed to save duplicate cache:', e.message);
    }
  }

  /**
   * Load duplicate prevention cache
   */
  async loadDuplicateCache() {
    try {
      const saved = await AsyncStorage.getItem('emergency_dup_cache');
      if (saved) {
        const cache = JSON.parse(saved);
        this.duplicatePreventionCache = new Map(cache);
        
        // Clean up old entries
        const now = Date.now();
        for (const [id, timestamp] of this.duplicatePreventionCache.entries()) {
          if (now - timestamp > this.DUP_CACHE_TTL_MS) {
            this.duplicatePreventionCache.delete(id);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load duplicate cache:', e.message);
    }
  }

  /**
   * Clean up old duplicate cache entries
   */
  async cleanupDuplicateCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, timestamp] of this.duplicatePreventionCache.entries()) {
      if (now - timestamp > this.DUP_CACHE_TTL_MS) {
        this.duplicatePreventionCache.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.saveDuplicateCache();
    }
    
    return cleaned;
  }
}

// Singleton instance
const gatewayManager = new EmergencyGatewayManager();

// Export functions
export async function initializeGatewayManager() {
  await gatewayManager.initialize();
  await gatewayManager.loadSOSState();
  return gatewayManager;
}

export function getGatewayManager() {
  return gatewayManager;
}

export function generateSOSId() {
  return generateCanonicalSOSId();
}