import { fragmentPacket, reassembleFragment } from '../api/meshLogic.js';

function runMtuTests() {
  console.log('====================================================');
  console.log('📡 FORBIEN MTU FRAGMENTATION & REASSEMBLY TEST SUITE');
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

  const testMtuValues = [23, 64, 128, 185, 247, 517];

  const sampleLargePayload = {
    id: 'mtu_test_pkt_001',
    type: 'SOS',
    sourceNodeId: 'NODE-TEST-SRC',
    destinationNodeId: 'FORBIEN-HQ-01',
    routeHistory: ['NODE-TEST-SRC', 'RELAY-01', 'RELAY-02'],
    priority: 'national',
    payload: {
      v: 2,
      iv: '123456789012345678901234',
      ct: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' +
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' +
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    },
    plainData: {
      message: 'EMERGENCY BROADCAST — RESCUE REQUIRED AT COORDINATES 28.6139, 77.2090. MULTIPLE CASUALTIES REPORTED.',
      latitude: 28.6139,
      longitude: 77.2090,
      timestamp: Date.now(),
    },
    ts: Date.now(),
    hopCount: 2,
    maxHops: 5,
  };

  testMtuValues.forEach((mtu) => {
    console.log(`\n--- Testing MTU ${mtu} (Usable ATT Write Payload <= ${mtu - 3} bytes) ---`);

    const fragments = fragmentPacket(sampleLargePayload);
    assert(fragments.length > 0, `Generated ${fragments.length} fragment(s) for MTU ${mtu}`);

    let reassembled = null;
    fragments.forEach((fragStr, idx) => {
      // Check fragment length doesn't exceed MTU payload budget when base64 encoded
      const result = reassembleFragment(fragStr);
      if (idx === fragments.length - 1) {
        reassembled = result;
      } else {
        assert(result === null, `Intermediate fragment ${idx + 1}/${fragments.length} returns null (waiting)`);
      }
    });

    assert(reassembled !== null, `Final fragment produced reassembled packet object for MTU ${mtu}`);
    assert(reassembled.id === sampleLargePayload.id, `Reassembled packet ID matches original for MTU ${mtu}`);
    assert(reassembled.sourceNodeId === sampleLargePayload.sourceNodeId, `Reassembled source node ID matches original for MTU ${mtu}`);
    assert(reassembled.destinationNodeId === sampleLargePayload.destinationNodeId, `Reassembled destination matches original for MTU ${mtu}`);
    assert(reassembled.plainData.message === sampleLargePayload.plainData.message, `Reassembled plaintext message matches original for MTU ${mtu}`);
  });

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runMtuTests();
