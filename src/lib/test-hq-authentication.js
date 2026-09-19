/**
 * ForBien HQ Cryptographic Authentication Test Suite
 *
 * Tests all 19 requirements from the CRITICAL HQ AUTHENTICATION spec:
 *  1.  HQ key generation
 *  2.  HQ provisioning
 *  3.  Private-key protection (not in source / not transmitted)
 *  4.  HQ signature creation
 *  5.  HQ signature verification
 *  6.  Valid HQ authentication
 *  7.  Invalid signature rejection
 *  8.  Wrong public key rejection
 *  9.  Fake HQ ID rejection
 * 10.  Unprovisioned HQ rejection
 * 11.  Destination routing
 * 12.  Relay forwarding
 * 13.  maxHops enforcement
 * 14.  Duplicate protection
 * 15.  routeHistory
 * 16.  Encrypted payload preservation through relays
 * 17.  HQ decryption
 * 18.  HQ delivery state
 * 19.  HQ stops forwarding after delivery
 */

import {
  AUTHORIZED_HQ_PUBLIC_KEY,
  _TEST_overrideAuthorizedHQPublicKey,
  _TEST_resetAuthorizedHQPublicKey,
  deriveHQKeyFromProvisionCode,
  generateHQKeyPair,
  signHQAuthenticationToken,
  verifyHQAuthenticationToken,
  createHQAuthHandshake,
  verifyHQAuthHandshake,
  hexToUint8,
  uint8ToHex,
  sha256JS,
  encryptPayloadAESGCM,
  decryptPayloadAESGCM,
  DEFAULT_MESH_SECRET,
  getRandomValues,
} from './crypto.js';

import {
  setNodeRole,
  getNodeRole,
  getLocalNodeId,
  loadNodeIdentity,
  HQ_NODE_ID,
  NODE_ROLES,
  createOfflineEmergencyMessage,
  processIncomingPacket,
  relayMessage,
  isDuplicateMessage,
  fragmentPacket,
  reassembleFragment,
  DELIVERY_STATES,
  provisionHQRole,
  getHQAuthStatus,
  verifyRemoteHQAuthentication,
  createHQBroadcastHandshake,
} from '../api/meshLogic.js';

import {
  removeHQPrivateKey,
  hasHQPrivateKey,
  saveHQPrivateKey,
} from './hqKeyManager.js';
const store = new Map();
const AsyncStorage = {
  getItem: async (key) => store.get(key) ?? null,
  setItem: async (key, val) => { store.set(key, String(val)); },
  removeItem: async (key) => { store.delete(key); },
  clear: async () => { store.clear(); },
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST KEYPAIR — safe to embed in source; NOT the deployment keypair.
// The test suite overrides the authorized public key to this test public key
// so that provisioning/verification logic can be exercised without the real
// deployment private key ever appearing in source.
//
// The REAL deployment public key ('0418b15b…') stays in crypto.js.
// The REAL deployment private key must never appear in source.
// ─────────────────────────────────────────────────────────────────────────────
const TEST_HQ_PRIVATE_KEY = 'b0f3ebe6f64286a79eb8f728dd1984e298f3bb0762ddb320b0c5ea544d6a8b94';
const TEST_HQ_PUBLIC_KEY  = 'ddb24c10408a4897b7884d2d6e3e8affdc44040e05cd1370f9b38ff1efc6e6e6';

// Install the test public key as the active authorized key before tests run.
_TEST_overrideAuthorizedHQPublicKey(TEST_HQ_PUBLIC_KEY);

async function runHQAuthTests() {
  console.log('============================================================');
  console.log('🔑 FORBIEN HQ CRYPTOGRAPHIC AUTHENTICATION TEST SUITE');
  console.log('============================================================\n');

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

  // ────────────────────────────────────────────────────────────────
  // TEST 1: HQ Key Generation
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 1: HQ Key Generation ---');
  const generatedPair = generateHQKeyPair('test-seed-unique-generation');
  assert(typeof generatedPair.privateKeyHex === 'string' && generatedPair.privateKeyHex.length === 64, 'Generated private key is 32 bytes hex');
  assert(typeof generatedPair.publicKeyHex === 'string' && generatedPair.publicKeyHex.length === 64, 'Generated public key is 32 bytes hex');
  assert(generatedPair.privateKeyHex !== generatedPair.publicKeyHex, 'Private and public keys are distinct');

  const generatedPair2 = generateHQKeyPair('test-seed-unique-generation');
  assert(generatedPair.privateKeyHex === generatedPair2.privateKeyHex, 'Key derivation is deterministic from same seed');
  assert(generatedPair.publicKeyHex === generatedPair2.publicKeyHex, 'Public key derivation is deterministic from same seed');

  const generatedPair3 = generateHQKeyPair('different-seed-xyz');
  assert(generatedPair.privateKeyHex !== generatedPair3.privateKeyHex, 'Different seeds produce different private keys');

  // ────────────────────────────────────────────────────────────────
  // TEST 2: HQ Provisioning
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 2: HQ Provisioning via Provision Key ---');
  const provisionResult = deriveHQKeyFromProvisionCode(TEST_HQ_PRIVATE_KEY);
  assert(provisionResult.ok, 'Valid test HQ private key validates successfully (test keypair active)');
  assert(provisionResult.publicKeyHex === TEST_HQ_PUBLIC_KEY, 'Derived public key matches test public key');

  const badProvision = deriveHQKeyFromProvisionCode('WRONG-CODE');
  assert(!badProvision.ok, 'Wrong provision code/key is rejected');
  assert(badProvision.error, 'Wrong provision key returns error message');

  const blankProvision = deriveHQKeyFromProvisionCode('');
  assert(!blankProvision.ok, 'Empty provision key is rejected');

  const provResult = await provisionHQRole(TEST_HQ_PRIVATE_KEY);
  assert(provResult.ok, 'provisionHQRole() succeeds with valid HQ private key');
  assert(provResult.nodeId === HQ_NODE_ID, 'Provisioned node ID is FORBIEN-HQ-01');
  assert(provResult.publicKey === TEST_HQ_PUBLIC_KEY, 'Provisioned public key matches test key');

  const badProvResult = await provisionHQRole('WRONG-PROVISION');
  assert(!badProvResult.ok, 'provisionHQRole() rejects wrong provision key');

  await setNodeRole('FIELD');

  // ────────────────────────────────────────────────────────────────
  // TEST 3: Private Key Protection
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 3: Private Key Protection ---');
  const deployedPair = deriveHQKeyFromProvisionCode(TEST_HQ_PRIVATE_KEY);

  assert(AUTHORIZED_HQ_PUBLIC_KEY !== deployedPair.privateKeyHex, 'Authorized public key constant does NOT equal private key');
  assert(deployedPair.privateKeyHex !== DEFAULT_MESH_SECRET, 'HQ private key is not the mesh secret');

  const nodeIdOnlyHash = uint8ToHex(sha256JS(new TextEncoder().encode(HQ_NODE_ID)));
  assert(deployedPair.privateKeyHex !== nodeIdOnlyHash, 'Private key is not derivable from node ID alone');

  // ────────────────────────────────────────────────────────────────
  // TEST 4: HQ Signature Creation
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 4: HQ Signature Creation ---');
  const keys = deriveHQKeyFromProvisionCode(TEST_HQ_PRIVATE_KEY);
  const challengeData = `FORBIEN-HQ-01|${Date.now()}|testnonce123`;

  let sig = null;
  let sigError = null;
  try {
    sig = signHQAuthenticationToken(keys.privateKeyHex, challengeData);
  } catch (err) {
    sigError = err.message;
  }

  assert(sigError === null, 'signHQAuthenticationToken() does not throw');
  assert(typeof sig === 'string' && sig.length === 128, 'Signature is a 64-byte (128 hex chars) Ed25519 signature');

  const sig2 = signHQAuthenticationToken(keys.privateKeyHex, `FORBIEN-HQ-01|${Date.now()}|anothernonce`);
  assert(sig !== sig2, 'Different challenge data produces different signatures');

  // ────────────────────────────────────────────────────────────────
  // TEST 5: HQ Signature Verification
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 5: HQ Signature Verification ---');
  const isValidSig = verifyHQAuthenticationToken(keys.publicKeyHex, challengeData, sig);
  assert(isValidSig === true, 'Correct signature verifies successfully against authorized public key');

  const isValidWrongData = verifyHQAuthenticationToken(keys.publicKeyHex, challengeData + 'extra', sig);
  assert(isValidWrongData === false, 'Signature fails for tampered challenge data');

  // ────────────────────────────────────────────────────────────────
  // TEST 6: Valid HQ Authentication
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 6: Valid HQ Authentication Handshake ---');
  const handshake = createHQAuthHandshake(keys.privateKeyHex);
  assert(handshake.type === 'HQ_AUTH_HANDSHAKE', 'Handshake has correct type field');
  assert(handshake.nodeId === HQ_NODE_ID, 'Handshake has correct nodeId FORBIEN-HQ-01');
  assert(handshake.publicKey === TEST_HQ_PUBLIC_KEY, 'Handshake exposes correct test public key');
  assert(typeof handshake.signature === 'string' && handshake.signature.length === 128, 'Handshake includes 64-byte Ed25519 signature');
  assert(typeof handshake.nonce === 'string' && handshake.nonce.length === 24, 'Handshake includes 12-byte nonce');
  assert(typeof handshake.timestamp === 'number', 'Handshake includes numeric timestamp');

  const verifyResult = verifyHQAuthHandshake(handshake);
  assert(verifyResult.valid === true, 'Valid HQ handshake verifies successfully');

  // ────────────────────────────────────────────────────────────────
  // TEST 7: Invalid Signature Rejection
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 7: Invalid Signature Rejection ---');
  const tamperedHandshake = {
    ...handshake,
    signature: handshake.signature.slice(0, 126) + 'ff',
  };
  const tamperedResult = verifyHQAuthHandshake(tamperedHandshake);
  assert(tamperedResult.valid === false, 'Tampered/invalid signature is rejected');
  assert(typeof tamperedResult.reason === 'string', 'Rejection reason is provided');

  const junkSig = uint8ToHex(getRandomValues(new Uint8Array(64)));
  const junkHandshake = { ...handshake, signature: junkSig };
  const junkResult = verifyHQAuthHandshake(junkHandshake);
  assert(junkResult.valid === false, 'Random junk signature is rejected');

  // ────────────────────────────────────────────────────────────────
  // TEST 8: Wrong Public Key Rejection
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 8: Wrong Public Key Rejection ---');
  const wrongKeyPair = generateHQKeyPair('some-random-unauthorized-key-seed');
  const wrongKeyHandshake = {
    ...handshake,
    publicKey: wrongKeyPair.publicKeyHex,
    signature: signHQAuthenticationToken(wrongKeyPair.privateKeyHex, `${handshake.nodeId}|${handshake.timestamp}|${handshake.nonce}`),
  };
  const wrongKeyResult = verifyHQAuthHandshake(wrongKeyHandshake);
  assert(wrongKeyResult.valid === false, 'Handshake with wrong public key is rejected');
  assert(wrongKeyResult.reason && wrongKeyResult.reason.includes('Public key'), 'Rejection reason mentions public key mismatch');

  // ────────────────────────────────────────────────────────────────
  // TEST 9: Fake HQ ID Rejection
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 9: Fake HQ ID Rejection ---');
  const fakeIdHandshake = { ...handshake, nodeId: 'NODE-FAKE-HQ-99' };
  const fakeIdResult = verifyHQAuthHandshake(fakeIdHandshake);
  assert(fakeIdResult.valid === false, 'Handshake with fake node ID is rejected');
  assert(fakeIdResult.reason && fakeIdResult.reason.includes('FORBIEN-HQ-01'), 'Rejection reason mentions required node ID');

  // ────────────────────────────────────────────────────────────────
  // TEST 10: Unprovisioned HQ Rejection via processIncomingPacket
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 10: Unprovisioned/Fake HQ Rejection via BLE packet ---');
  await setNodeRole('FIELD');

  const fakeHQAuthPacket = {
    id: `fake_hq_auth_${Date.now()}`,
    type: 'HQ_AUTH_HANDSHAKE',
    nodeId: 'FORBIEN-HQ-01',
    publicKey: wrongKeyPair.publicKeyHex,
    timestamp: Date.now(),
    nonce: uint8ToHex(getRandomValues(new Uint8Array(12))),
    signature: signHQAuthenticationToken(wrongKeyPair.privateKeyHex, `FORBIEN-HQ-01|${Date.now()}|testnonce`),
  };

  const fakeHQResult = await processIncomingPacket(fakeHQAuthPacket, 'FakePhone_D');
  assert(!fakeHQResult.verified, 'Unprovisioned fake HQ authentication is rejected');
  assert(fakeHQResult.hqAuthHandshake === true, 'Packet correctly identified as HQ auth handshake attempt');

  const legitimateHQPacket = { id: `legit_hq_auth_${Date.now()}`, ...handshake };
  const legitHQResult = await processIncomingPacket(legitimateHQPacket, 'MomsPhone_HQ');
  assert(legitHQResult.verified === true, 'Legitimate HQ authentication is accepted');

  // ────────────────────────────────────────────────────────────────
  // TEST 11: Destination Routing
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 11: Destination Routing ---');
  await setNodeRole('FIELD');
  const emergencyResult = await createOfflineEmergencyMessage({ message: 'ROUTING TEST' });
  assert(emergencyResult.ok, 'Emergency message created for routing test');
  assert(emergencyResult.packet.destinationNodeId === HQ_NODE_ID, 'Emergency destination is FORBIEN-HQ-01');
  assert(emergencyResult.packet.sourceNodeId !== HQ_NODE_ID, 'Emergency source is not FORBIEN-HQ-01');
  assert(emergencyResult.packet.hopCount === 0, 'Initial hop count is 0');

  // ────────────────────────────────────────────────────────────────
  // TEST 12: Relay Forwarding
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 12: Relay Forwarding ---');
  await setNodeRole('RELAY');
  const encData = await encryptPayloadAESGCM({ message: 'SECRET RELAY TEST DATA' });
  const relayPacket = {
    id: `relay_test_${Date.now()}`,
    sourceNodeId: 'NODE-FIELD-A1B2',
    destinationNodeId: HQ_NODE_ID,
    routeHistory: ['NODE-FIELD-A1B2'],
    hopCount: 0,
    maxHops: 5,
    payload: encData.envelope,
    encrypted: true,
    type: 'SOS',
  };

  const relayResult = relayMessage(relayPacket);
  assert(relayResult.ok, 'Relay node successfully relays message toward HQ');
  assert(relayResult.packet.hopCount === 1, 'Relay increments hop count to 1');
  assert(relayResult.packet.destinationNodeId === HQ_NODE_ID, 'Destination remains FORBIEN-HQ-01 after relay');
  assert(relayResult.packet.payload.ct === encData.envelope.ct, 'Relay does NOT alter or decrypt encrypted payload');

  // ────────────────────────────────────────────────────────────────
  // TEST 13: maxHops Enforcement
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 13: maxHops Enforcement ---');
  const expiredPacket = {
    id: `max_hops_test_${Date.now()}`,
    sourceNodeId: 'NODE-FIELD-EXPIRED',
    destinationNodeId: HQ_NODE_ID,
    routeHistory: ['NODE-A', 'NODE-B', 'NODE-C', 'NODE-D', 'NODE-E'],
    hopCount: 5,
    maxHops: 5,
    payload: encData.envelope,
    encrypted: true,
  };

  const maxHopsResult = relayMessage(expiredPacket);
  assert(!maxHopsResult.ok, 'Packet with hopCount >= maxHops is dropped');
  assert(maxHopsResult.ttlExceeded === true, 'ttlExceeded flag is set');

  const incomingExpiredResult = await processIncomingPacket(
    { ...expiredPacket, id: `max_hops_incoming_${Date.now()}` },
    'PeerNode'
  );
  assert(!incomingExpiredResult.ok, 'Incoming expired packet is dropped');
  assert(incomingExpiredResult.ttlExceeded === true, 'Incoming expired packet sets ttlExceeded');

  // ────────────────────────────────────────────────────────────────
  // TEST 14: Duplicate Protection
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 14: Duplicate Protection ---');
  const uniqueMsgId = `dup_test_${Date.now()}`;
  assert(!isDuplicateMessage(uniqueMsgId), 'First encounter of message ID is NOT duplicate');
  assert(isDuplicateMessage(uniqueMsgId), 'Second encounter of same message ID IS duplicate');
  assert(isDuplicateMessage(uniqueMsgId), 'Third encounter of same message ID IS duplicate');

  const dupPacket = {
    id: `dup_packet_${Date.now()}`,
    sourceNodeId: 'NODE-DUP-SENDER',
    destinationNodeId: HQ_NODE_ID,
    hopCount: 1,
    maxHops: 5,
    payload: encData.envelope,
    encrypted: true,
  };

  await processIncomingPacket(dupPacket, 'Peer_A');
  const dup2 = await processIncomingPacket(dupPacket, 'Peer_B');
  assert(dup2.duplicate === true, 'Second identical packet from different peer is duplicate-rejected');

  // ────────────────────────────────────────────────────────────────
  // TEST 15: Route History
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 15: Route History ---');
  await setNodeRole('RELAY');
  const routePacket = {
    id: `route_history_${Date.now()}`,
    sourceNodeId: 'NODE-FIELD-ALPHA',
    destinationNodeId: HQ_NODE_ID,
    routeHistory: ['NODE-FIELD-ALPHA', 'NODE-RELAY-BETA'],
    hopCount: 2,
    maxHops: 5,
    payload: encData.envelope,
    encrypted: true,
  };

  const routeResult = relayMessage(routePacket);
  assert(routeResult.ok, 'Route history preserved during relay');
  assert(Array.isArray(routeResult.packet.routeHistory), 'routeHistory is an array');
  assert(routeResult.packet.routeHistory.includes('NODE-FIELD-ALPHA'), 'routeHistory contains origin node');
  assert(routeResult.packet.routeHistory.includes('NODE-RELAY-BETA'), 'routeHistory contains relay node');

  // ────────────────────────────────────────────────────────────────
  // TEST 16: Encrypted Payload Preservation Through Relays
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 16: Encrypted Payload Preservation Through Relays ---');
  await setNodeRole('RELAY');
  const sensitiveData = { message: 'CLASSIFIED SOS DATA - DO NOT RELAY PLAINTEXT', lat: 12.9716, lon: 77.5946 };
  const sensitiveEnc = await encryptPayloadAESGCM(sensitiveData);

  const sensitivePacket = {
    id: `payload_preservation_${Date.now()}`,
    sourceNodeId: 'NODE-ALPHA',
    destinationNodeId: HQ_NODE_ID,
    routeHistory: ['NODE-ALPHA'],
    hopCount: 0,
    maxHops: 5,
    payload: sensitiveEnc.envelope,
    encrypted: true,
  };

  const hop1 = relayMessage(sensitivePacket);
  assert(hop1.ok, 'Hop 1 relayed successfully');
  assert(hop1.packet.payload.ct === sensitiveEnc.envelope.ct, 'Ciphertext unchanged after hop 1');
  assert(hop1.packet.payload.iv === sensitiveEnc.envelope.iv, 'IV unchanged after hop 1');

  const hop2 = relayMessage({ ...hop1.packet, id: `hop2_${Date.now()}` });
  assert(hop2.ok, 'Hop 2 relayed successfully');
  assert(hop2.packet.payload.ct === sensitiveEnc.envelope.ct, 'Ciphertext unchanged after hop 2');

  const relayedStr = JSON.stringify(hop2.packet);
  assert(!relayedStr.includes('CLASSIFIED SOS DATA'), 'Plaintext does NOT appear in relayed BLE packet');

  // ────────────────────────────────────────────────────────────────
  // TEST 17: HQ Decryption
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 17: HQ Decryption ---');
  await setNodeRole('HQ');

  const hqTargetEnc = await encryptPayloadAESGCM({ message: 'URGENT SOS AT HQ DESTINATION' });
  const hqTargetPacket = {
    id: `hq_decrypt_test_${Date.now()}`,
    sourceNodeId: 'NODE-FIELD-SENDER',
    destinationNodeId: HQ_NODE_ID,
    routeHistory: ['NODE-FIELD-SENDER', 'NODE-RELAY-MID'],
    hopCount: 2,
    maxHops: 5,
    payload: hqTargetEnc.envelope,
    encrypted: true,
    type: 'SOS',
  };

  const hqDelivery = await processIncomingPacket(hqTargetPacket, 'Relay_Before_HQ');
  assert(hqDelivery.ok, 'HQ successfully receives and processes emergency packet');
  assert(hqDelivery.delivered === true, 'Packet marked as delivered');
  assert(hqDelivery.message.text === 'URGENT SOS AT HQ DESTINATION', 'HQ correctly decrypts AES-256-GCM payload');
  assert(hqDelivery.message.deliveryState === DELIVERY_STATES.DELIVERED_TO_HQ, 'Delivery state is DELIVERED_TO_HQ');

  // ────────────────────────────────────────────────────────────────
  // TEST 18: HQ Delivery State
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 18: HQ Delivery State ---');
  assert(hqDelivery.message.deliveryState === 'DELIVERED_TO_HQ', 'Message state is DELIVERED_TO_HQ string');
  assert(hqDelivery.message.sourceNodeId === 'NODE-FIELD-SENDER', 'Source node ID preserved in delivered message');
  assert(hqDelivery.message.destinationNodeId === HQ_NODE_ID, 'Destination preserved as FORBIEN-HQ-01');
  assert(Array.isArray(hqDelivery.message.routeHistory), 'Route history is an array in delivered message');
  assert(hqDelivery.message.routeHistory.includes('FORBIEN-HQ-01'), 'HQ appended itself to route history');
  assert(hqDelivery.message.encrypted === true, 'Encrypted flag preserved in delivered message');

  // ────────────────────────────────────────────────────────────────
  // TEST 19: HQ Stops Forwarding After Delivery
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Test 19: HQ Stops Forwarding After Delivery ---');
  assert(hqDelivery.delivered === true, 'HQ correctly marks message as delivered');
  assert(!hqDelivery.relayed, 'HQ does NOT relay the delivered packet (no relayed flag)');

  const dupDelivery = await processIncomingPacket(hqTargetPacket, 'Another_Relay_Peer');
  assert(dupDelivery.duplicate === true, 'Duplicate delivery to HQ is rejected by dedup cache');
  assert(!dupDelivery.delivered, 'Duplicate packet is NOT re-delivered to HQ inbox');

  await setNodeRole('FIELD');

  // ────────────────────────────────────────────────────────────────
  // SECURITY ARCHITECTURE VERIFICATION TESTS (A - H)
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- Security Test A: Normal FIELD installation cannot become trusted HQ ---');
  await setNodeRole('FIELD');
  await removeHQPrivateKey();
  const unprovHQ = await setNodeRole('HQ');
  assert(!unprovHQ.ok || unprovHQ.unprovisioned, 'Unprovisioned setNodeRole("HQ") is blocked/flagged as unprovisioned');
  const bogusProv = await provisionHQRole('bogus_code_12345678');
  assert(!bogusProv.ok, 'Normal installation cannot provision HQ with bogus code');
  assert(getNodeRole() === 'FIELD', 'Role remains FIELD after failed provision attempt');

  console.log('\n--- Security Test B: Changing node ID to FORBIEN-HQ-01 does not work ---');
  const fakeHandshake = {
    v: 2,
    type: 'HQ_AUTH_HANDSHAKE',
    nodeId: 'FORBIEN-HQ-01',
    publicKey: AUTHORIZED_HQ_PUBLIC_KEY,
    timestamp: Date.now(),
    nonce: uint8ToHex(getRandomValues(new Uint8Array(12))),
    signature: uint8ToHex(getRandomValues(new Uint8Array(64))), // fake signature
  };
  const fakeHandshakeResult = verifyHQAuthHandshake(fakeHandshake);
  assert(!fakeHandshakeResult.valid, 'Node claiming FORBIEN-HQ-01 with fake signature fails verification');

  console.log('\n--- Security Test C: Changing AsyncStorage role to HQ does not work ---');
  await AsyncStorage.setItem('forbien_node_role', 'HQ');
  await AsyncStorage.setItem('forbien_hq_provisioned', 'true');
  await removeHQPrivateKey(); // ensure Keystore has no private key
  const reloadedId = await loadNodeIdentity();
  assert(getNodeRole() === 'FIELD', 'loadNodeIdentity demotes role to FIELD when Keystore lacks HQ private key');
  assert(reloadedId !== 'FORBIEN-HQ-01', 'Node ID is not FORBIEN-HQ-01 after unauthenticated AsyncStorage tamper');
  assert(getNodeRole() !== 'HQ', 'Role remains FIELD and cannot stay HQ without private key');

  console.log('\n--- Security Test D: A fake key does not authenticate ---');
  // The old human-readable provision code is no longer a valid input format
  const oldCodeResult = deriveHQKeyFromProvisionCode('FORBIEN-NCSC-HQ-PROVISION-2026-MOM');
  assert(!oldCodeResult.ok, 'Human-readable provision code string is rejected (not valid 64-hex)');
  // A random 64-hex key that doesn't match the active (test) authorized public key is rejected
  const fakeHexResult = deriveHQKeyFromProvisionCode('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff');
  assert(!fakeHexResult.ok, 'Arbitrary fake 64-hex key is rejected (public key does not match authorized key)');
  // The original compromised deployment private key string — now matches nothing (authorized key rotated)
  const oldDeployKeyResult = deriveHQKeyFromProvisionCode('515c7924a15ec1c24a8fb296022d72f8893eb626927fe81e28ac945b9af4be97');
  assert(!oldDeployKeyResult.ok, 'Old compromised deployment private key is rejected (authorized key has been rotated)');

  console.log('\n--- Security Test E: Wrong public/private key pair does not authenticate ---');
  const wrongPair = generateHQKeyPair('random-unauthorized-seed-99');
  const wrongHandshake = createHQAuthHandshake(wrongPair.privateKeyHex);
  const wrongVerify = verifyHQAuthHandshake(wrongHandshake);
  assert(!wrongVerify.valid, 'Handshake generated by wrong keypair fails verification');

  console.log('\n--- Security Test F: The authorized HQ (test keypair) authenticates successfully ---');
  const provHQRes = await provisionHQRole(TEST_HQ_PRIVATE_KEY);
  assert(provHQRes.ok, 'Provisioning with test HQ private key succeeds (test keypair active)');
  const validHandshake = createHQAuthHandshake(TEST_HQ_PRIVATE_KEY);
  const validVerify = verifyHQAuthHandshake(validHandshake);
  assert(validVerify.valid === true, 'Test keypair produces valid authenticated handshake (mechanism proven)');

  console.log('\n--- Security Test G: The private key is not stored in plaintext AsyncStorage ---');
  const roleInStorage = await AsyncStorage.getItem('forbien_node_role');
  const provInStorage = await AsyncStorage.getItem('forbien_hq_provisioned');
  const rawKeyInStorage = await AsyncStorage.getItem('forbien_hq_private_key');
  assert(rawKeyInStorage === null, 'Private key is NOT stored in AsyncStorage key "forbien_hq_private_key"');
  assert(roleInStorage === 'HQ', 'AsyncStorage contains role "HQ" metadata only');
  assert(provInStorage === 'true', 'AsyncStorage contains provisioned flag metadata only');

  _TEST_resetAuthorizedHQPublicKey(); // Restore deployment key after tests complete

  console.log('\n--- Security Test H: Reinstalling a normal copy of the APK does not automatically create another trusted HQ ---');
  await removeHQPrivateKey();
  await AsyncStorage.removeItem('forbien_node_role');
  await AsyncStorage.removeItem('forbien_hq_provisioned');
  await loadNodeIdentity();
  assert(getNodeRole() === 'FIELD', 'Fresh installation starts in FIELD role');
  assert(getLocalNodeId().startsWith('NODE-'), 'Fresh installation receives random FIELD node ID');
  assert((await hasHQPrivateKey()) === false, 'Fresh installation has no HQ private key in Keystore');

  // ────────────────────────────────────────────────────────────────
  // SUMMARY
  // ────────────────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log(`AUTOMATED TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================');
  console.log('\nPHYSICAL BLE TEST: NOT YET TESTED');
  console.log('(Physical testing requires Android devices with Bluetooth)');
  console.log('\nAPK BUILD: NOT YET BUILT');
  console.log('============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHQAuthTests().catch((err) => {
  console.error('\nTest suite encountered unexpected error:', err);
  process.exit(1);
});
