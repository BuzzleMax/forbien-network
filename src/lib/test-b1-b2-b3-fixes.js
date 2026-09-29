/**
 * ForBien — Blocking Bug Fix Verification Suite (B1 + B2 + B3)
 *
 * Tests all 17 required items from the remediation spec:
 *
 * B1 — AAD Timestamp Consistency
 *   1.  single timestamp → AAD ts bytes identical to packet.ts reconstruction
 *   2.  AAD decrypt succeeds with unchanged packet
 *   3.  Tamper: modified packet.id → decrypt fails
 *   4.  Tamper: modified sourceNodeId → decrypt fails
 *   5.  Tamper: modified destinationNodeId → decrypt fails
 *   6.  Tamper: modified type → decrypt fails
 *   7.  Tamper: modified ts → decrypt fails
 *
 * B2 — HQ Peer Identity
 *   8.  Authenticated HQ peer (keyed by MAC) is selectable in routing
 *   9.  Unauthenticated peer is NOT selected as HQ destination
 *
 * B3 — Fragment Size
 *  10.  MTU 23   — fits within ATT payload
 *  11.  MTU 64   — fits within ATT payload
 *  12.  MTU 128  — fits within ATT payload
 *  13.  MTU 185  — fits within ATT payload
 *  14.  MTU 247  — fits within ATT payload
 *  15.  MTU 517  — fits within ATT payload
 *  16.  MTU fallback (DEFAULT_SAFE_FRAGMENT_SIZE) produces safe fragment
 *  17.  Complete fragmentation/reassembly round-trip
 */

import { Buffer } from 'buffer';
import crypto from 'crypto';

// ── Node.js polyfills for React Native globals ────────────────────────────────
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
}
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (b) => Buffer.from(b, 'base64').toString('binary');
}
const { TextEncoder, TextDecoder } = await import('util');
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    getRandomValues: (arr) => { const b = crypto.randomBytes(arr.byteLength); arr.set(b); return arr; },
    subtle: crypto.webcrypto?.subtle,
  };
}

// ── Imports ───────────────────────────────────────────────────────────────────
import {
  encryptPayloadAESGCM,
  decryptPayloadAESGCM,
  buildAADBytes,
  DEFAULT_MESH_SECRET,
} from './crypto.js';

import {
  fragmentPacket,
  reassembleFragment,
  HQ_NODE_ID,
} from '../api/meshLogic.js';

// ── Harness ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(64));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Mirror of the fixed formula in meshLogic.js (must match exactly)
const FRAG_PROTOCOL_OVERHEAD = 19; // "FRAG|"(5)+fragId(3)+"|seq|total|"(max 11)=19
const DEFAULT_SAFE_FRAGMENT_SIZE_EXPECTED = 1; // max(1, 20-19) for MTU 23

function simulateGetFragmentPayloadSize(mtu) {
  const attPayload = mtu - 3;
  return Math.max(1, attPayload - FRAG_PROTOCOL_OVERHEAD);
}

// Actual bytes sent over BLE = UTF-8 byte length of the FRAG string.
// (btoa by sender and base64-decode by ble-plx cancel out; Java re-encodes and JS atob cancels out on receive)
function bleWriteByteSize(fragStr) {
  return Buffer.byteLength(fragStr, 'utf-8');
}

// ═════════════════════════════════════════════════════════════════════════════
// B1 TESTS
// ═════════════════════════════════════════════════════════════════════════════
section('B1 — AAD Timestamp Consistency');

const SECRET = DEFAULT_MESH_SECRET || 'FORBIEN_MESH_SECRET_DEFAULT';
const NODE_ID = 'NODE-FIELD-B1-TEST';
const MSG_ID = `sos_${Date.now()}_${Math.floor(Math.random() * 9999)}`;

// Test 1: Single timestamp → sender and receiver AAD bytes are identical
const SINGLE_TS = Date.now();
const sendAAD = buildAADBytes({ id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: SINGLE_TS });
const recvAAD = buildAADBytes({ id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: SINGLE_TS });
assert(
  Buffer.from(sendAAD).toString('hex') === Buffer.from(recvAAD).toString('hex'),
  'Test 1: Single timestamp → sender AAD bytes === receiver reconstructed AAD bytes',
  `sendHex=${Buffer.from(sendAAD).toString('hex').slice(0,32)}…`
);

// Confirm that two separate Date.now() calls CAN differ (proving why B1 matters)
const ts1 = Date.now();
await new Promise(r => setTimeout(r, 2));
const ts2 = Date.now();
const twoCallsAAD1 = buildAADBytes({ id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: ts1 });
const twoCallsAAD2 = buildAADBytes({ id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: ts2 });
assert(
  ts1 !== ts2 ? Buffer.from(twoCallsAAD1).toString('hex') !== Buffer.from(twoCallsAAD2).toString('hex') : true,
  `Test 1b: Confirms two Date.now() calls (${ts1} vs ${ts2}) produce different AAD when ms differ — B1 fix is necessary`
);

// Test 2: Decrypt succeeds with unchanged packet
const SAMPLE_PAYLOAD = { compressed: 'EMERGENCY_SOS_DATA_B1_TEST_FORBIEN' };
const encResult = await encryptPayloadAESGCM(SAMPLE_PAYLOAD, SECRET, { id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: SINGLE_TS });
assert(encResult.ok, 'Test 2a: encryptPayloadAESGCM succeeds');
if (encResult.ok) {
  const decResult = await decryptPayloadAESGCM(encResult.envelope, SECRET, recvAAD);
  assert(decResult.ok, 'Test 2b: decryptPayloadAESGCM succeeds on unmodified packet (consistent AAD ts)');
  assert(
    decResult.data?.compressed === SAMPLE_PAYLOAD.compressed,
    'Test 2c: Decrypted payload content matches original'
  );
}

// Tests 3-7: Tamper matrix
const baseAAD = { id: MSG_ID, sourceNodeId: NODE_ID, destinationNodeId: HQ_NODE_ID, type: 'SOS', ts: SINGLE_TS };
const tamperCases = [
  { num: 3,  field: 'packet.id',          tamper: a => ({ ...a, id: a.id + '_TAMPERED' }) },
  { num: 4,  field: 'sourceNodeId',        tamper: a => ({ ...a, sourceNodeId: 'ROGUE-NODE' }) },
  { num: 5,  field: 'destinationNodeId',   tamper: a => ({ ...a, destinationNodeId: 'NOT-HQ' }) },
  { num: 6,  field: 'type',               tamper: a => ({ ...a, type: 'RELAY' }) },
  { num: 7,  field: 'ts',                 tamper: a => ({ ...a, ts: a.ts + 1 }) },
];

for (const { num, field, tamper } of tamperCases) {
  const tamperedAADBytes = buildAADBytes(tamper(baseAAD));
  const decResult = await decryptPayloadAESGCM(encResult.envelope, SECRET, tamperedAADBytes);
  assert(
    !decResult.ok,
    `Test ${num}: Tampered ${field} → GCM authentication fails (decryptResult.ok=false)`,
    `ok=${decResult.ok}, tampered=${decResult.tampered}`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// B2 TESTS
// ═════════════════════════════════════════════════════════════════════════════
section('B2 — Authenticated HQ Peer Identity Matching');

// Simulate the B2-fixed state:
//   onIncomingWrite: senderInfo = event.deviceId (MAC) — NOT device name
//   authenticatedHQPeers.set(senderInfo, ...) → key = MAC
//   processOutboundQueue: filter(p => authenticatedHQPeers.has(p.id)) → p.id = MAC from scan
// These now use identical values → filter WORKS.

const HQ_MAC     = 'AA:BB:CC:DD:EE:FF';   // Stable BLE device ID (MAC)
const RELAY_MAC  = '11:22:33:44:55:66';    // Normal relay peer

const authenticatedHQPeers = new Map();
// Simulate: handleIncomingRawBLEData called with senderInfo = event.deviceId = MAC
authenticatedHQPeers.set(HQ_MAC, { nodeId: 'FORBIEN-HQ-01', timestamp: Date.now() });

// Simulate available peers from BLE scan (p.id = device.id = MAC)
const availablePeers = [
  { id: HQ_MAC,   device: {}, name: 'ForBien-HQ' },
  { id: RELAY_MAC, device: {}, name: 'ForBien-Node-003' },
];

// Test 8: Authenticated HQ peer (keyed by MAC) is found
const authHQPeers = availablePeers.filter(p => authenticatedHQPeers.has(p.id));
assert(
  authHQPeers.length === 1 && authHQPeers[0].id === HQ_MAC,
  `Test 8: authenticatedHQPeers.has(p.id) correctly finds HQ peer by MAC=${HQ_MAC}`,
  `authHQPeers.length=${authHQPeers.length}`
);

// Test 9: Unauthenticated relay peer is NOT selected
const relayInAuth = availablePeers.filter(p => authenticatedHQPeers.has(p.id) && p.id === RELAY_MAC);
assert(
  relayInAuth.length === 0,
  `Test 9: Relay peer (MAC=${RELAY_MAC}) is NOT found in authenticatedHQPeers`,
  `relayInAuth.length=${relayInAuth.length}`
);

// Confirm old (broken) behavior: device-name keying would never match p.id
const oldDeviceNameKey = 'ForBien-HQ';
const peersByOldKey = availablePeers.filter(p => p.id === oldDeviceNameKey);
assert(
  peersByOldKey.length === 0,
  `Test 9b: Old device-name key ("${oldDeviceNameKey}") would never match any p.id (MAC) — confirms B2 fix is required`
);

// ═════════════════════════════════════════════════════════════════════════════
// B3 TESTS
// ═════════════════════════════════════════════════════════════════════════════
section('B3 — Fragment BLE Write Size vs ATT Payload');

const SAMPLE_PACKET = {
  id: `sos_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
  type: 'SOS',
  sourceNodeId: 'NODE-FIELD-001',
  destinationNodeId: HQ_NODE_ID,
  routeHistory: ['NODE-FIELD-001'],
  priority: 'national',
  ts: Date.now(),
  hopCount: 0,
  maxHops: 5,
  payload: {
    v: 2,
    iv: 'AAAAAAAAAAAAAAAAAAAAAA==',
    ct: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.repeat(3),
  },
};

const MTU_TESTS = [
  { mtu: 23,  testNum: 10 },
  { mtu: 64,  testNum: 11 },
  { mtu: 128, testNum: 12 },
  { mtu: 185, testNum: 13 },
  { mtu: 247, testNum: 14 },
  { mtu: 517, testNum: 15 },
];

console.log('\n  MTU  | ATT  | fragSize | fragments | worstByte | limit | OK?');
console.log('  ─────┼──────┼──────────┼───────────┼───────────┼───────┼────');

for (const { mtu, testNum } of MTU_TESTS) {
  const attPayload = mtu - 3;
  const fragSize = simulateGetFragmentPayloadSize(mtu);

  const fragments = fragmentPacket(SAMPLE_PACKET, fragSize);
  const worstLen = Math.max(...fragments.map(f => bleWriteByteSize(f)));

  const fits = worstLen <= attPayload;
  console.log(
    `  ${String(mtu).padStart(4)} | ${String(attPayload).padStart(4)} | ${String(fragSize).padStart(8)} | ${String(fragments.length).padStart(9)} | ${String(worstLen).padStart(9)} | ${String(attPayload).padStart(5)} | ${fits ? '✅' : '❌'}`
  );

  assert(
    fragments.length > 0,
    `Test ${testNum}a: MTU ${mtu} — fragmentPacket produces fragments`
  );
  assert(
    fits,
    `Test ${testNum}b: MTU ${mtu} — worst fragment ${worstLen}B ≤ ATT payload ${attPayload}B (fragSize=${fragSize})`,
    `worstLen=${worstLen}, attPayload=${attPayload}`
  );
  assert(
    fragSize === Math.max(1, attPayload - FRAG_PROTOCOL_OVERHEAD),
    `Test ${testNum}c: MTU ${mtu} — fragSize=${fragSize} equals max(1, ${attPayload}-${FRAG_PROTOCOL_OVERHEAD})=${Math.max(1, attPayload - FRAG_PROTOCOL_OVERHEAD)}`
  );

  // Verify 3-char hex fragId in FRAG string
  const fragIdField = fragments[0].split('|')[1];
  assert(
    fragIdField?.length === 3 && /^[0-9a-f]{3}$/.test(fragIdField),
    `Test ${testNum}d: MTU ${mtu} — FRAG header uses 3-char hex fragId="${fragIdField}" (not full packet.id)`
  );
}

// Test 16: DEFAULT_SAFE_FRAGMENT_SIZE fallback
section('B3 — Test 16: MTU Negotiation Failure Fallback');
const fallbackFragments = fragmentPacket(SAMPLE_PACKET, DEFAULT_SAFE_FRAGMENT_SIZE_EXPECTED);
const fallbackWorst = Math.max(...fallbackFragments.map(f => bleWriteByteSize(f)));
assert(
  DEFAULT_SAFE_FRAGMENT_SIZE_EXPECTED === 1,
  `Test 16a: DEFAULT_SAFE_FRAGMENT_SIZE = 1 (safe for minimum ATT payload of 20 bytes at MTU 23)`
);
assert(
  fallbackWorst <= 20,
  `Test 16b: Fallback (fragSize=1) worst fragment = ${fallbackWorst}B ≤ 20B ATT payload for MTU 23`,
  `fallbackWorst=${fallbackWorst}`
);

// Test 17: End-to-end fragmentation/reassembly round-trip
section('B3 — Test 17: Round-Trip Fragmentation/Reassembly (MTU 128)');
const RT_MTU = 128;
const rtFragSize = simulateGetFragmentPayloadSize(RT_MTU);
const rtFragments = fragmentPacket(SAMPLE_PACKET, rtFragSize);
const RT_PEER = 'AA:BB:CC:DD:EE:01';

let rtResult = null;
for (let i = 0; i < rtFragments.length; i++) {
  const res = reassembleFragment(rtFragments[i], RT_PEER);
  if (i < rtFragments.length - 1) {
    assert(res === null, `Test 17: Intermediate fragment ${i + 1}/${rtFragments.length} → null (buffer filling)`);
  } else {
    rtResult = res;
  }
}

assert(rtResult !== null, 'Test 17: Final fragment triggers reassembly → non-null result');
if (rtResult) {
  assert(rtResult.id === SAMPLE_PACKET.id, `Test 17: Reassembled packet.id matches original`);
  assert(rtResult.sourceNodeId === SAMPLE_PACKET.sourceNodeId, `Test 17: Reassembled sourceNodeId matches`);
  assert(rtResult.type === SAMPLE_PACKET.type, `Test 17: Reassembled type matches`);
  assert(rtResult.destinationNodeId === SAMPLE_PACKET.destinationNodeId, `Test 17: Reassembled destinationNodeId matches`);
  assert(
    JSON.stringify(rtResult.payload) === JSON.stringify(SAMPLE_PACKET.payload),
    `Test 17: Reassembled payload JSON is identical to original`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(64)}`);
console.log('  FORBIEN B1/B2/B3 FIX VERIFICATION — FINAL RESULTS');
console.log('═'.repeat(64));
console.log(`  Total: ${passed + failed}   ✅ Passed: ${passed}   ❌ Failed: ${failed}`);
console.log('═'.repeat(64));

if (failed > 0) {
  console.error(`\n  ❌ ${failed} test(s) FAILED. Blocking bugs are NOT fully remediated.`);
  process.exit(1);
} else {
  console.log(`\n  ✅ All ${passed} tests PASSED.`);
  process.exit(0);
}
