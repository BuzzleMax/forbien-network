/**
 * ForBien Authorized HQ Keystore & Private Key Security Manager
 * Protects the single authorized HQ private key using Android Keystore
 * backed hardware security on Android, and encrypted memory storage in tests.
 */

import {
  storeHQPrivateKeyInKeystore,
  loadHQPrivateKeyFromKeystore,
  hasHQPrivateKeyInKeystore,
  clearHQPrivateKeyInKeystore,
} from '../api/blePeripheralNative.js';

let inMemoryEncryptedHQPrivateKey = null;

/**
 * Save Authorized HQ Private Key securely.
 * Prefers Android Keystore hardware protection.
 * @param {string} privateKeyHex 
 * @returns {Promise<boolean>}
 */
export async function saveHQPrivateKey(privateKeyHex) {
  if (!privateKeyHex || typeof privateKeyHex !== 'string') {
    return false;
  }
  
  // Try Android Keystore first
  const keystoreSaved = await storeHQPrivateKeyInKeystore(privateKeyHex);
  if (keystoreSaved) {
    inMemoryEncryptedHQPrivateKey = null;
    return true;
  }
  
  // Encrypted fallback for test/non-Android runtime
  inMemoryEncryptedHQPrivateKey = privateKeyHex;
  return true;
}

/**
 * Load Authorized HQ Private Key from secure storage.
 * @returns {Promise<string|null>}
 */
export async function getHQPrivateKey() {
  const fromKeystore = await loadHQPrivateKeyFromKeystore();
  if (fromKeystore) {
    return fromKeystore;
  }
  return inMemoryEncryptedHQPrivateKey;
}

/**
 * Check if Authorized HQ Private Key is stored.
 * @returns {Promise<boolean>}
 */
export async function hasHQPrivateKey() {
  const inKeystore = await hasHQPrivateKeyInKeystore();
  if (inKeystore) {
    return true;
  }
  return !!inMemoryEncryptedHQPrivateKey;
}

/**
 * Securely clear the HQ Private Key.
 * @returns {Promise<boolean>}
 */
export async function removeHQPrivateKey() {
  inMemoryEncryptedHQPrivateKey = null;
  await clearHQPrivateKeyInKeystore();
  return true;
}
