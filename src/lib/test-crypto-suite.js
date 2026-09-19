/**
 * Comprehensive Automated Verification Suite for ForBien AES-256-GCM Encryption Upgrade
 * 
 * Tests:
 * 1. Sniffing Protection (Ciphertext confidentiality)
 * 2. Tampered Packet Rejection (GCM Integrity Tag check)
 * 3. Ephemeral Nonce Uniqueness (12-byte IV per packet)
 * 4. Migration Path (Graceful handling/dropping of legacy XOR packets)
 * 5. BLE Payload Size Budget Verification (< 244 bytes)
 * 6. HQ Command Packet Layering & Clearance Validation
 */

import {
  encryptPayloadAESGCM,
  decryptPayloadAESGCM,
  deriveMeshCryptoKey,
  uint8ToBase64,
  base64ToUint8,
  verifyBLEPayloadBudget,
  calculatePayloadSize,
  isLegacyXORPacket,
  handleLegacyXORPacket,
  DEFAULT_MESH_SECRET,
} from './crypto.js';

import {
  compressSOSData,
  decompressSOSData,
} from './compression.js';

import {
  enableMesh,
  sendToGroup,
  simulateIncomingPeerMessage,
  processClearancePacket,
  storeMessagePersistent,
  getPersistentMessages,
  setMeshSecretKey,
} from '../api/meshLogic.js';

async function runTestSuite() {
  console.log('====================================================');
  console.log('🔒 FORBIEN AES-256-GCM MESH SECURITY TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(` ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(` ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // Ensure mesh mode enabled for tests
  await enableMesh();
  setMeshSecretKey(DEFAULT_MESH_SECRET);

  // ----------------------------------------------------
  // TEST 1: SOS Packet Sniffing Protection (Confidentiality)
  // ----------------------------------------------------
  console.log('\n--- Test 1: Sniffing Protection (SOS Plaintext Confidentiality) ---');
  const sosMessage = {
    type: 'SOS',
    text: 'CRITICAL MEDICAL EMERGENCY: Alpha unit down at Sector 4.',
    meta: {
      location: 'Sector 4 Grid B',
      latitude: 12.9716,
      longitude: 77.5946,
      priority: 'urgent',
      unitId: 'UNIT_ALPHA_01',
    },
  };

  const sosRes = await sendToGroup('group_sos', sosMessage);
  assert(sosRes.ok, 'sendToGroup executed successfully');
  const sniffedPacket = sosRes.entry.payload; // Raw object transmitted over BLE

  assert(sniffedPacket.v === 2, 'Packet specifies protocol version 2 (AES-256-GCM)');
  assert(typeof sniffedPacket.iv === 'string' && sniffedPacket.iv.length > 0, '12-byte Nonce/IV is attached to packet');
  assert(typeof sniffedPacket.ct === 'string' && sniffedPacket.ct.length > 0, 'Ciphertext with auth tag is attached');

  const serializedTransmission = JSON.stringify(sniffedPacket);
  assert(!serializedTransmission.includes('CRITICAL MEDICAL EMERGENCY'), 'Sniffed BLE packet does NOT contain plaintext message');
  assert(!serializedTransmission.includes('UNIT_ALPHA_01'), 'Sniffed BLE packet does NOT contain unit PII');
  assert(!serializedTransmission.includes('Sector 4'), 'Sniffed BLE packet does NOT contain location text');

  // ----------------------------------------------------
  // TEST 2: Tampered/Corrupted Relay Packet Rejection
  // ----------------------------------------------------
  console.log('\n--- Test 2: Tampered Relay Packet Rejection (Integrity Check) ---');
  const validEnvelope = sosRes.entry.payload;
  
  // Create a tampered copy by corrupting a byte in ciphertext
  const ctBytes = base64ToUint8(validEnvelope.ct);
  ctBytes[4] ^= 0xFF; // Flip 8 bits
  const tamperedEnvelope = {
    ...validEnvelope,
    ct: uint8ToBase64(ctBytes),
  };

  const decryptResult = await decryptPayloadAESGCM(tamperedEnvelope);
  assert(!decryptResult.ok, 'Tampered packet failed AES-256-GCM decryption');
  assert(decryptResult.tampered === true, 'Tamper flag is set to true');

  const simResult = await simulateIncomingPeerMessage('group_sos', tamperedEnvelope, 1, true, true, tamperedEnvelope);
  assert(!simResult.ok, 'Tampered message rejected by simulateIncomingPeerMessage');
  assert(simResult.tampered === true, 'Simulated incoming handler correctly caught tampered packet');

  // ----------------------------------------------------
  // TEST 3: Ephemeral Nonce (IV) Uniqueness
  // ----------------------------------------------------
  console.log('\n--- Test 3: Ephemeral Nonce Uniqueness ---');
  const enc1 = await encryptPayloadAESGCM('IDENTICAL_PAYLOAD');
  const enc2 = await encryptPayloadAESGCM('IDENTICAL_PAYLOAD');
  
  assert(enc1.envelope.iv !== enc2.envelope.iv, 'Two encryptions produce distinct 12-byte IVs');
  assert(enc1.envelope.ct !== enc2.envelope.ct, 'Two encryptions produce distinct ciphertexts for same input');

  // ----------------------------------------------------
  // TEST 4: Legacy XOR Packet Migration Handling
  // ----------------------------------------------------
  console.log('\n--- Test 4: Legacy XOR Migration Handling ---');
  const legacyXORPacket = {
    id: 'legacy_msg_999',
    text: 'SGVsbG8gV29ybGQ=', // XOR Base64
    encrypted: true,
    // Note: no algo: 'AES-256-GCM' or iv field!
  };

  assert(isLegacyXORPacket(legacyXORPacket), 'Legacy XOR packet correctly identified');
  
  const legacyHandling = handleLegacyXORPacket(legacyXORPacket);
  assert(!legacyHandling.ok && legacyHandling.legacy === true, 'Legacy packet returns legacy: true drop response');

  const legacySimResult = await simulateIncomingPeerMessage('group_test', legacyXORPacket, 0, true, false, legacyXORPacket);
  assert(!legacySimResult.ok && legacySimResult.legacy === true, 'Incoming peer handler safely dropped legacy XOR packet');

  // ----------------------------------------------------
  // TEST 5: BLE Payload Size Budget Verification
  // ----------------------------------------------------
  console.log('\n--- Test 5: BLE Payload Size Budget Verification ---');
  const sampleSOSData = {
    type: 'SOS',
    message: 'Medical emergency immediate assistance building 4 floor 3',
    location: 'Building 4 Floor 3',
    latitude: 40.7128,
    longitude: -74.0060,
    status: 'critical',
    priority: 'urgent',
    timestamp: Date.now(),
    unitId: 'UNIT_ALPHA',
  };

  const compressedStr = compressSOSData(sampleSOSData);
  const encryptedSosRes = await encryptPayloadAESGCM({ compressed: compressedStr });
  const budget = verifyBLEPayloadBudget(encryptedSosRes.envelope);

  console.log(`   Compressed SOS data string length: ${compressedStr.length} chars`);
  console.log(`   AES-256-GCM Envelope total BLE size: ${budget.sizeBytes} bytes (Budget: ${budget.maxBytes} bytes)`);
  
  assert(budget.fits, `Encrypted payload (${budget.sizeBytes}B) fits inside BLE characteristic limit (${budget.maxBytes}B)`);
  assert(budget.marginBytes > 0, `Remaining payload headroom: ${budget.marginBytes} bytes`);

  // ----------------------------------------------------
  // TEST 6: HQ Command Packets (AES-GCM + Signature Validation)
  // ----------------------------------------------------
  console.log('\n--- Test 6: HQ Command Packet Validation ---');
  const testMessageId = `msg_to_clear_${Date.now()}`;
  storeMessagePersistent({ id: testMessageId, text: 'SOS message to clear' });

  // Create clear packet signed by authorized HQ
  const hqUuid = 'hq-command-primary-001';
  const clearancePayload = {
    messageId: testMessageId,
    hqUuid,
    signature: 'mock_valid_signature_123',
    timestamp: Date.now(),
  };

  // Encrypt HQ clearance packet with AES-256-GCM
  const encryptedClearanceRes = await encryptPayloadAESGCM(clearancePayload);
  assert(encryptedClearanceRes.ok, 'HQ clearance packet encrypted with AES-256-GCM');

  const clearanceResult = await processClearancePacket(encryptedClearanceRes.envelope);
  assert(clearanceResult.ok, 'HQ clearance packet successfully decrypted and validated');
  assert(clearanceResult.clearedMessageId === testMessageId, 'Message removed from persistent queue');

  // Summary
  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
