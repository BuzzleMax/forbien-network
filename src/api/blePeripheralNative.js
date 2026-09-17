let NativeModules = {};
let NativeEventEmitter = class { addListener() { return { remove: () => {} }; } };
let Platform = { OS: 'unknown' };

try {
  const RN = require('react-native');
  NativeModules = RN.NativeModules || {};
  NativeEventEmitter = RN.NativeEventEmitter || NativeEventEmitter;
  Platform = RN.Platform || Platform;
} catch {
  // Node / Unit test environment fallback
}

const { BleGattServerModule } = NativeModules;

const eventEmitter = BleGattServerModule
  ? new NativeEventEmitter(BleGattServerModule)
  : null;

/**
 * Check if BLE Peripheral GATT server mode is supported on this device
 * @returns {Promise<boolean>}
 */
export async function isPeripheralSupported() {
  if (Platform.OS !== 'android' || !BleGattServerModule) {
    return false;
  }
  try {
    return await BleGattServerModule.isPeripheralSupported();
  } catch {
    return false;
  }
}

/**
 * Start native Android GATT Server listening on Service 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function startGattServer() {
  if (Platform.OS !== 'android' || !BleGattServerModule) {
    return { ok: false, error: 'BleGattServerModule not available on this platform' };
  }
  try {
    const success = await BleGattServerModule.startGattServer();
    return { ok: !!success };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Start BLE Peripheral Advertising
 * @param {string} localName - Advertised device name
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function startAdvertising(localName = 'ForBien') {
  if (Platform.OS !== 'android' || !BleGattServerModule) {
    return { ok: false, error: 'BleGattServerModule not available on this platform' };
  }
  try {
    const success = await BleGattServerModule.startAdvertising(localName);
    return { ok: !!success };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Stop BLE Peripheral Advertising
 * @returns {Promise<{ok: boolean}>}
 */
export async function stopAdvertising() {
  if (Platform.OS !== 'android' || !BleGattServerModule) {
    return { ok: true };
  }
  try {
    await BleGattServerModule.stopAdvertising();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Stop native GATT Server
 * @returns {Promise<{ok: boolean}>}
 */
export async function stopGattServer() {
  if (Platform.OS !== 'android' || !BleGattServerModule) {
    return { ok: true };
  }
  try {
    await BleGattServerModule.stopGattServer();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Subscribe to native incoming GATT characteristic write events (incoming BLE packets)
 * @param {(data: {deviceId: string, deviceName: string, dataBase64: string, characteristicUuid: string}) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onIncomingWrite(callback) {
  if (!eventEmitter) return () => {};
  const subscription = eventEmitter.addListener('onBleCharacteristicWrite', callback);
  return () => {
    subscription.remove();
  };
}

/**
 * Subscribe to BLE Central connections to our GATT server
 * @param {(data: {deviceId: string, deviceName: string}) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onCentralConnected(callback) {
  if (!eventEmitter) return () => {};
  const subscription = eventEmitter.addListener('onBleCentralConnected', callback);
  return () => {
    subscription.remove();
  };
}

/**
 * Store HQ private key in Android Keystore
 * @param {string} privateKeyHex 
 * @returns {Promise<boolean>}
 */
export async function storeHQPrivateKeyInKeystore(privateKeyHex) {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.storeHQPrivateKeyInKeystore) {
    return false;
  }
  try {
    return await BleGattServerModule.storeHQPrivateKeyInKeystore(privateKeyHex);
  } catch {
    return false;
  }
}

/**
 * Load HQ private key from Android Keystore
 * @returns {Promise<string|null>}
 */
export async function loadHQPrivateKeyFromKeystore() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.loadHQPrivateKeyFromKeystore) {
    return null;
  }
  try {
    return await BleGattServerModule.loadHQPrivateKeyFromKeystore();
  } catch {
    return null;
  }
}

/**
 * Check if HQ private key exists in Android Keystore
 * @returns {Promise<boolean>}
 */
export async function hasHQPrivateKeyInKeystore() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.hasHQPrivateKeyInKeystore) {
    return false;
  }
  try {
    return await BleGattServerModule.hasHQPrivateKeyInKeystore();
  } catch {
    return false;
  }
}

/**
 * Clear HQ private key from Android Keystore
 * @returns {Promise<boolean>}
 */
export async function clearHQPrivateKeyInKeystore() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.clearHQPrivateKeyInKeystore) {
    return true;
  }
  try {
    return await BleGattServerModule.clearHQPrivateKeyInKeystore();
  } catch {
    return false;
  }
}

/**
 * Get Bluetooth Adapter State
 * @returns {Promise<string>}
 */
export async function getAdapterState() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.getAdapterState) {
    return 'UNAVAILABLE';
  }
  try {
    return await BleGattServerModule.getAdapterState();
  } catch {
    return 'UNAVAILABLE';
  }
}

/**
 * Check Bluetooth & Location Android Permissions
 * @returns {Promise<Object|null>}
 */
export async function checkPermissions() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.checkPermissions) {
    return null;
  }
  try {
    return await BleGattServerModule.checkPermissions();
  } catch {
    return null;
  }
}

/**
 * Request Bluetooth & Location Android Permissions
 * @returns {Promise<boolean>}
 */
export async function requestPermissions() {
  if (Platform.OS !== 'android' || !BleGattServerModule || !BleGattServerModule.requestPermissions) {
    return false;
  }
  try {
    return await BleGattServerModule.requestPermissions();
  } catch {
    return false;
  }
}


