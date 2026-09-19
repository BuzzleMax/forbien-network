/**
 * Emergency Multi-Gateway Functionality Test Suite
 * 
 * Tests the independent gateway delivery system:
 * - Canonical SOS event ID generation
 * - Independent gateway state tracking
 * - BLE gateway integration
 * - SMS gateway simulation
 * - Call gateway simulation
 * - Gateway capability detection
 * - Duplicate SOS prevention
 * - Offline queue persistence
 * - GPS unavailable handling
 * - Multi-gateway coordination
 */

// Mock AsyncStorage for testing
const mockAsyncStorage = new Map();

function mockAsyncStorageSetItem(key, value) {
  mockAsyncStorage.set(key, value);
  return Promise.resolve();
}

function mockAsyncStorageGetItem(key) {
  return Promise.resolve(mockAsyncStorage.get(key) || null);
}

function mockAsyncStorageRemoveItem(key) {
  mockAsyncStorage.delete(key);
  return Promise.resolve();
}

const mockAsyncStorageModule = {
  getItem: mockAsyncStorageGetItem,
  setItem: mockAsyncStorageSetItem,
  removeItem: mockAsyncStorageRemoveItem,
};

const {
  initializeGatewayManager,
  getGatewayManager,
  generateSOSId,
  GATEWAY_TYPES,
  GATEWAY_STATES,
} = require('./emergencyGatewayManager.js');

/**
 * Gateway Simulation Test Harness
 */
class GatewaySimulationHarness {
  constructor() {
    this.gatewayCapabilities = {
      [GATEWAY_TYPES.BLE]: true,
      [GATEWAY_TYPES.SMS]: true,
      [GATEWAY_TYPES.CALL]: true,
    };
    this.smsSent = false;
    this.callInitiated = false;
    this.bleDelivered = false;
    this.smsAttempts = [];
    this.callAttempts = [];
    this.bleAttempts = [];
  }

  setCapability(gatewayType, available) {
    this.gatewayCapabilities[gatewayType] = available;
  }

  simulateSMSSent(phoneNumber, message) {
    this.smsSent = true;
    this.smsAttempts.push({ phoneNumber, message, timestamp: Date.now() });
  }

  simulateCallInitiated(phoneNumber) {
    this.callInitiated = true;
    this.callAttempts.push({ phoneNumber, timestamp: Date.now() });
  }

  simulateBLEDelivered(packetId) {
    this.bleDelivered = true;
    this.bleAttempts.push({ packetId, timestamp: Date.now() });
  }

  reset() {
    this.smsSent = false;
    this.callInitiated = false;
    this.bleDelivered = false;
    this.smsAttempts = [];
    this.callAttempts = [];
    this.bleAttempts = [];
  }

  getResults() {
    return {
      smsSent: this.smsSent,
      callInitiated: this.callInitiated,
      bleDelivered: this.bleDelivered,
      smsAttempts: this.smsAttempts.length,
      callAttempts: this.callAttempts.length,
      bleAttempts: this.bleAttempts.length,
    };
  }
}

/**
 * Cleanup between tests
 */
async function cleanupTestState() {
  const manager = getGatewayManager();
  if (manager) {
    await manager.clearSOS();
    // Inject mock AsyncStorage for the next test
    manager._TEST_setAsyncStorage(mockAsyncStorageModule);
  }
  mockAsyncStorage.clear();
}

/**
 * Test Scenario 1: BLE available, SMS unavailable, call available
 */
async function testScenario1() {
  console.log('\n=== SCENARIO 1: BLE available, SMS unavailable, call available ===');
  
  const harness = new GatewaySimulationHarness();
  harness.setCapability(GATEWAY_TYPES.BLE, true);
  harness.setCapability(GATEWAY_TYPES.SMS, false);
  harness.setCapability(GATEWAY_TYPES.CALL, true);
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Override capabilities for simulation
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 1',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_NOT_AVAILABLE,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_AVAILABLE,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 2: BLE unavailable, SMS available, call available
 */
async function testScenario2() {
  console.log('\n=== SCENARIO 2: BLE unavailable, SMS available, call available ===');
  
  const harness = new GatewaySimulationHarness();
  harness.setCapability(GATEWAY_TYPES.BLE, false);
  harness.setCapability(GATEWAY_TYPES.SMS, true);
  harness.setCapability(GATEWAY_TYPES.CALL, true);
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Override capabilities for simulation
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 2',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED, // BLE still queued even if unavailable
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_READY,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_AVAILABLE,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 3: BLE available, SMS available, call unavailable
 */
async function testScenario3() {
  console.log('\n=== SCENARIO 3: BLE available, SMS available, call unavailable ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Override capabilities for simulation
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, false);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 3',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_READY,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_FAILED,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 4: BLE unavailable, SMS unavailable, call available
 */
async function testScenario4() {
  console.log('\n=== SCENARIO 4: BLE unavailable, SMS unavailable, call available ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Override capabilities for simulation
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 4',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_NOT_AVAILABLE,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_AVAILABLE,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 5: All available
 */
async function testScenario5() {
  console.log('\n=== SCENARIO 5: All available ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Set all capabilities to true
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 5',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_READY,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_AVAILABLE,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 6: All unavailable
 */
async function testScenario6() {
  console.log('\n=== SCENARIO 6: All unavailable ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  // Set all capabilities to false
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, false);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, false);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 6',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const expectedStates = {
    [GATEWAY_TYPES.BLE]: GATEWAY_STATES.BLE_QUEUED,
    [GATEWAY_TYPES.SMS]: GATEWAY_STATES.SMS_NOT_AVAILABLE,
    [GATEWAY_TYPES.CALL]: GATEWAY_STATES.CALL_FAILED,
  };
  
  for (const [gateway, expectedState] of Object.entries(expectedStates)) {
    if (result.gatewayStates[gateway] !== expectedState) {
      return { passed: false, error: `${gateway} state mismatch: expected ${expectedState}, got ${result.gatewayStates[gateway]}` };
    }
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 7: BLE delivery succeeds but SMS fails
 */
async function testScenario7() {
  console.log('\n=== SCENARIO 7: BLE delivery succeeds but SMS fails ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 7',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  // Simulate BLE success
  await manager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_DELIVERED_TO_HQ, {
    packetId: 'test-packet-123',
  });
  
  // Simulate SMS failure
  await manager.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_FAILED, {
    error: 'SMS failed',
  });
  
  const status = manager.getSOSStatus();
  
  if (status.gatewayStates[GATEWAY_TYPES.BLE] !== GATEWAY_STATES.BLE_DELIVERED_TO_HQ) {
    return { passed: false, error: 'BLE should be delivered' };
  }
  
  if (status.gatewayStates[GATEWAY_TYPES.SMS] !== GATEWAY_STATES.SMS_FAILED) {
    return { passed: false, error: 'SMS should be failed' };
  }
  
  // Verify CALL gateway is still available for manual use
  if (status.gatewayStates[GATEWAY_TYPES.CALL] !== GATEWAY_STATES.CALL_AVAILABLE) {
    return { passed: false, error: 'CALL should still be available' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 8: SMS succeeds but BLE fails
 */
async function testScenario8() {
  console.log('\n=== SCENARIO 8: SMS succeeds but BLE fails ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 8',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  // Simulate SMS success
  await manager.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_HANDED_TO_SMS_APP, {
    phoneNumber: '1234567890',
    messageId: 'sms-123',
  });
  
  // Simulate BLE failure
  await manager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_FAILED, {
    error: 'No BLE peers available',
  });
  
  const status = manager.getSOSStatus();
  
  if (status.gatewayStates[GATEWAY_TYPES.SMS] !== GATEWAY_STATES.SMS_HANDED_TO_SMS_APP) {
    return { passed: false, error: 'SMS should be handed to app' };
  }
  
  if (status.gatewayStates[GATEWAY_TYPES.BLE] !== GATEWAY_STATES.BLE_FAILED) {
    return { passed: false, error: 'BLE should be failed' };
  }
  
  // Verify CALL gateway is still available for manual use
  if (status.gatewayStates[GATEWAY_TYPES.CALL] !== GATEWAY_STATES.CALL_AVAILABLE) {
    return { passed: false, error: 'CALL should still be available' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 9: BLE succeeds while call is initiated
 */
async function testScenario9() {
  console.log('\n=== SCENARIO 9: BLE succeeds while call is initiated ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 9',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  // Simulate BLE success
  await manager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_DELIVERED_TO_HQ, {
    packetId: 'test-packet-123',
  });
  
  // Simulate call initiated
  await manager.updateGatewayState(GATEWAY_TYPES.CALL, GATEWAY_STATES.CALL_DIALER_OPENED, {
    phoneNumber: '911',
  });
  
  const status = manager.getSOSStatus();
  
  if (status.gatewayStates[GATEWAY_TYPES.BLE] !== GATEWAY_STATES.BLE_DELIVERED_TO_HQ) {
    return { passed: false, error: 'BLE should be delivered' };
  }
  
  if (status.gatewayStates[GATEWAY_TYPES.CALL] !== GATEWAY_STATES.CALL_DIALER_OPENED) {
    return { passed: false, error: 'CALL should be initiated' };
  }
  
  // Verify SMS gateway is still available
  if (status.gatewayStates[GATEWAY_TYPES.SMS] !== GATEWAY_STATES.SMS_READY) {
    return { passed: false, error: 'SMS should still be ready' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 10: Multiple gateway attempts for the same SOS
 */
async function testScenario10() {
  console.log('\n=== SCENARIO 10: Multiple gateway attempts for the same SOS ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  manager.gatewayCapabilities.set(GATEWAY_TYPES.BLE, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.SMS, true);
  manager.gatewayCapabilities.set(GATEWAY_TYPES.CALL, true);
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 10',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const canonicalId = result.canonicalId;
  
  // Try to create another SOS with same data immediately
  const result2 = await manager.createSOS(emergencyData);
  
  // Should be rejected as duplicate (active SOS exists)
  if (result2.ok) {
    return { passed: false, error: 'Duplicate SOS should be rejected when active SOS exists' };
  }
  
  // Verify the original SOS is still active
  const status = manager.getSOSStatus();
  if (status.canonicalId !== canonicalId) {
    return { passed: false, error: 'Original SOS should still be active' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 11: Duplicate SOS prevention using canonical event ID
 */
async function testScenario11() {
  console.log('\n=== SCENARIO 11: Duplicate SOS prevention using canonical event ID ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 11',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  // Create first SOS
  const result1 = await manager.createSOS(emergencyData);
  
  if (!result1.ok) {
    return { passed: false, error: result1.error };
  }
  
  const canonicalId1 = result1.canonicalId;
  
  // Try to create duplicate immediately
  const result2 = await manager.createSOS(emergencyData);
  
  // Should be rejected as duplicate (active SOS exists)
  if (result2.ok) {
    return { passed: false, error: 'Immediate duplicate should be rejected when active SOS exists' };
  }
  
  // Clear and try again with different data
  await manager.clearSOS();
  
  const emergencyData2 = {
    message: 'TEST SOS - SCENARIO 11 - DIFFERENT',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result3 = await manager.createSOS(emergencyData2);
  
  if (!result3.ok) {
    return { passed: false, error: 'Different SOS should be accepted' };
  }
  
  const canonicalId2 = result3.canonicalId;
  
  // Verify different canonical IDs
  if (canonicalId1 === canonicalId2) {
    return { passed: false, error: 'Different SOS should have different canonical IDs' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 12: App restart after SOS
 */
async function testScenario12() {
  console.log('\n=== SCENARIO 12: App restart after SOS ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 12',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const canonicalId = result.canonicalId;
  
  // Simulate app restart by loading state
  await manager.loadSOSState();
  
  const status = manager.getSOSStatus();
  
  if (!status.active) {
    return { passed: false, error: 'SOS should be restored after restart' };
  }
  
  if (status.canonicalId !== canonicalId) {
    return { passed: false, error: 'Canonical ID should be preserved' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 13: Offline queue persistence
 */
async function testScenario13() {
  console.log('\n=== SCENARIO 13: Offline queue persistence ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 13',
    location: { lat: 37.7749, lng: -122.4194 },
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  // Simulate gateway state changes
  await manager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_RELAYING);
  await manager.updateGatewayState(GATEWAY_TYPES.SMS, GATEWAY_STATES.SMS_READY);
  
  // Save state
  await manager.saveSOSState();
  
  // Verify the state was saved to mock storage
  const savedState = mockAsyncStorage.get('emergency_sos_state');
  if (!savedState) {
    return { passed: false, error: 'State was not saved to mock AsyncStorage' };
  }
  
  // Clear current state
  manager.activeSOS = null;
  
  // Clear mock storage to simulate app restart with fresh storage
  // Actually, we want to keep the storage to simulate persistence
  // So we DON'T clear it - we just clear the in-memory state
  
  // Reload state
  await manager.loadSOSState();
  
  const status = manager.getSOSStatus();
  
  if (!status.active) {
    return { passed: false, error: 'SOS should be restored from persistence' };
  }
  
  if (status.gatewayStates[GATEWAY_TYPES.BLE] !== GATEWAY_STATES.BLE_RELAYING) {
    return { passed: false, error: 'BLE state should be preserved' };
  }
  
  if (status.gatewayStates[GATEWAY_TYPES.SMS] !== GATEWAY_STATES.SMS_READY) {
    return { passed: false, error: 'SMS state should be preserved' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 14: GPS unavailable
 */
async function testScenario14() {
  console.log('\n=== SCENARIO 14: GPS unavailable ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 14',
    location: null, // GPS unavailable
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  const status = manager.getSOSStatus();
  
  if (status.location !== null) {
    return { passed: false, error: 'Location should be null when GPS unavailable' };
  }
  
  // Verify SOS can still be created without GPS
  if (!status.active) {
    return { passed: false, error: 'SOS should be active even without GPS' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Test Scenario 15: GPS becomes available after SOS creation
 */
async function testScenario15() {
  console.log('\n=== SCENARIO 15: GPS becomes available after SOS creation ===');
  
  const manager = getGatewayManager();
  await manager.initialize();
  
  const emergencyData = {
    message: 'TEST SOS - SCENARIO 15',
    location: null, // GPS unavailable initially
    priority: 'national',
  };
  
  const result = await manager.createSOS(emergencyData);
  
  if (!result.ok) {
    return { passed: false, error: result.error };
  }
  
  // Simulate GPS becoming available
  const newLocation = { lat: 37.7749, lng: -122.4194 };
  manager.activeSOS.location = newLocation;
  await manager.saveSOSState();
  
  const status = manager.getSOSStatus();
  
  if (status.location === null) {
    return { passed: false, error: 'Location should be updated when GPS becomes available' };
  }
  
  if (status.location.lat !== newLocation.lat) {
    return { passed: false, error: 'Location coordinates should match' };
  }
  
  await manager.clearSOS();
  return { passed: true };
}

/**
 * Run all gateway tests
 */
async function runGatewayTests() {
  console.log('====================================================');
  console.log('🚀 EMERGENCY MULTI-GATEWAY TEST SUITE');
  console.log('====================================================\n');
  
  const tests = [
    { name: 'Scenario 1: BLE available, SMS unavailable, call available', fn: testScenario1 },
    { name: 'Scenario 2: BLE unavailable, SMS available, call available', fn: testScenario2 },
    { name: 'Scenario 3: BLE available, SMS available, call unavailable', fn: testScenario3 },
    { name: 'Scenario 4: BLE unavailable, SMS unavailable, call available', fn: testScenario4 },
    { name: 'Scenario 5: All available', fn: testScenario5 },
    { name: 'Scenario 6: All unavailable', fn: testScenario6 },
    { name: 'Scenario 7: BLE delivery succeeds but SMS fails', fn: testScenario7 },
    { name: 'Scenario 8: SMS succeeds but BLE fails', fn: testScenario8 },
    { name: 'Scenario 9: BLE succeeds while call is initiated', fn: testScenario9 },
    { name: 'Scenario 10: Multiple gateway attempts for the same SOS', fn: testScenario10 },
    { name: 'Scenario 11: Duplicate SOS prevention using canonical event ID', fn: testScenario11 },
    { name: 'Scenario 12: App restart after SOS', fn: testScenario12 },
    { name: 'Scenario 13: Offline queue persistence', fn: testScenario13 },
    { name: 'Scenario 14: GPS unavailable', fn: testScenario14 },
    { name: 'Scenario 15: GPS becomes available after SOS creation', fn: testScenario15 },
  ];
  
  let passed = 0;
  let failed = 0;
  const results = [];
  
  for (const test of tests) {
    try {
      // Cleanup before each test
      await cleanupTestState();
      
      const result = await test.fn();
      if (result.passed) {
        console.log(`✅ ${test.name} PASSED`);
        passed++;
        results.push({ name: test.name, passed: true });
      } else {
        console.error(`❌ ${test.name} FAILED: ${result.error}`);
        failed++;
        results.push({ name: test.name, passed: false, error: result.error });
      }
    } catch (error) {
      console.error(`❌ ${test.name} ERROR:`, error.message);
      failed++;
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }
  
  console.log('\n====================================================');
  console.log('📊 GATEWAY TEST RESULTS');
  console.log('====================================================\n');
  console.log(`TOTAL TESTS: ${tests.length}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  
  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    for (const result of results) {
      if (!result.passed) {
        console.log(`  - ${result.name}: ${result.error}`);
      }
    }
  }
  
  console.log('\n====================================================');
  if (failed === 0) {
    console.log('✅ ALL GATEWAY TESTS PASSED');
  } else {
    console.log('❌ SOME GATEWAY TESTS FAILED');
  }
  console.log('====================================================\n');
  
  return { total: tests.length, passed, failed, results };
}

// Run tests if this file is executed directly
if (require.main === module) {
  runGatewayTests()
    .then((results) => {
      process.exit(results.failed === 0 ? 0 : 1);
    })
    .catch((error) => {
      console.error('Test error:', error);
      process.exit(1);
    });
}

module.exports = {
  runGatewayTests,
  GatewaySimulationHarness,
  testScenario1,
  testScenario2,
  testScenario3,
  testScenario4,
  testScenario5,
  testScenario6,
  testScenario7,
  testScenario8,
  testScenario9,
  testScenario10,
  testScenario11,
  testScenario12,
  testScenario13,
  testScenario14,
  testScenario15,
};