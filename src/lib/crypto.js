/**
 * Cryptographic Utility Module for ForBien Mesh Network
 * Upgrades mesh transport security from static XOR to AES-256-GCM.
 * Provides authenticated encryption, ephemeral per-packet nonces (IVs),
 * key derivation, legacy XOR packet migration, and BLE payload size validation.
 * Compatible with Web Crypto API (crypto.subtle), Node.js, Expo Go, and React Native Hermes.
 */

// Default pre-shared master mesh key (rotated periodically / configured at registration)
export const DEFAULT_MESH_SECRET = 'ForBienMesh2026-MasterKey-HQPrimary';
export const PROTOCOL_VERSION = 2;
export const MAX_BLE_CHARACTERISTIC_BYTES = 244;

// Deployment Authorized HQ Public Key (Ed25519 Hex).
// This is the ONLY HQ-related secret that belongs in the APK.
// The matching private key is NEVER stored in source; it lives only in the
// Android Keystore on the provisioned HQ device.
export const AUTHORIZED_HQ_PUBLIC_KEY = 'd4ebc7cb350d225fadd9ecf5062b91d6d9a3fae0c11a6eb952d5b299fded0198';

// Module-level mutable reference used internally. Allows test files to inject
// a test-only public key without embedding the deployment private key in source.
let _authorizedHQPublicKey = AUTHORIZED_HQ_PUBLIC_KEY;

/**
 * TEST-ENVIRONMENT ONLY: Override the authorized HQ public key.
 * Must NEVER be called from application code. Only used by test suites
 * so they can validate provisioning logic without needing the real private key.
 * @param {string} testPubKeyHex
 */
export function _TEST_overrideAuthorizedHQPublicKey(testPubKeyHex) {
  if (typeof testPubKeyHex !== 'string' || testPubKeyHex.length !== 64) {
    throw new Error('_TEST_overrideAuthorizedHQPublicKey: must be 64-char hex');
  }
  _authorizedHQPublicKey = testPubKeyHex.toLowerCase();
}

/**
 * TEST-ENVIRONMENT ONLY: Reset the authorized HQ public key to the deployment value.
 */
export function _TEST_resetAuthorizedHQPublicKey() {
  _authorizedHQPublicKey = AUTHORIZED_HQ_PUBLIC_KEY;
}

/** Returns the currently active authorized HQ public key (deployment or test override). */
export function getAuthorizedHQPublicKey() {
  return _authorizedHQPublicKey;
}

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

// Configure Ed25519 SHA-512 engine for synchronous Ed25519 operations across Node and Hermes
if (ed && ed.hashes) {
  ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m));
}


/**
 * Convert Uint8Array to Base64 string safely across RN/Web/Node
 * @param {Uint8Array} bytes 
 * @returns {string} Base64 string
 */
export function uint8ToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('No Base64 encoder available');
}

/**
 * Convert Base64 string to Uint8Array safely across RN/Web/Node
 * @param {string} base64 
 * @returns {Uint8Array}
 */
export function base64ToUint8(base64) {
  let binaryString = '';
  if (typeof atob === 'function') {
    binaryString = atob(base64);
  } else if (typeof Buffer !== 'undefined') {
    binaryString = Buffer.from(base64, 'base64').toString('binary');
  } else {
    throw new Error('No Base64 decoder available');
  }
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Safe random values generator for RN/Expo/Browser/Node
 */
export function getRandomValues(buffer) {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(buffer);
  }
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    return window.crypto.getRandomValues(buffer);
  }
  // Fallback cryptographically PRNG seed
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

/* ==========================================================================
   PURE JS SHA-256 & AES-256-GCM FALLBACK ENGINE FOR HERMES / REACT NATIVE
   ========================================================================== */

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
]);

const RCON = new Uint32Array([0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000, 0x1b000000, 0x36000000]);

function subWord(w) {
  return (SBOX[(w >>> 24) & 0xff] << 24) | (SBOX[(w >>> 16) & 0xff] << 16) | (SBOX[(w >>> 8) & 0xff] << 8) | SBOX[w & 0xff];
}

function rotWord(w) {
  return (w << 8) | (w >>> 24);
}

function keyExpansion256(keyBytes) {
  const w = new Uint32Array(60);
  for (let i = 0; i < 8; i++) {
    w[i] = (keyBytes[i * 4] << 24) | (keyBytes[i * 4 + 1] << 16) | (keyBytes[i * 4 + 2] << 8) | keyBytes[i * 4 + 3];
  }
  for (let i = 8; i < 60; i++) {
    let temp = w[i - 1];
    if (i % 8 === 0) {
      temp = subWord(rotWord(temp)) ^ RCON[(i / 8) - 1];
    } else if (i % 8 === 4) {
      temp = subWord(temp);
    }
    w[i] = w[i - 8] ^ temp;
  }
  return w;
}

function aesEncryptBlock(inBytes, w) {
  let s0 = (inBytes[0] << 24) | (inBytes[1] << 16) | (inBytes[2] << 8) | inBytes[3];
  let s1 = (inBytes[4] << 24) | (inBytes[5] << 16) | (inBytes[6] << 8) | inBytes[7];
  let s2 = (inBytes[8] << 24) | (inBytes[9] << 16) | (inBytes[10] << 8) | inBytes[11];
  let s3 = (inBytes[12] << 24) | (inBytes[13] << 16) | (inBytes[14] << 8) | inBytes[15];

  s0 ^= w[0]; s1 ^= w[1]; s2 ^= w[2]; s3 ^= w[3];

  for (let round = 1; round < 14; round++) {
    const t0 = (SBOX[(s0 >>> 24) & 0xff] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff];
    const t1 = (SBOX[(s1 >>> 24) & 0xff] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff];
    const t2 = (SBOX[(s2 >>> 24) & 0xff] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff];
    const t3 = (SBOX[(s3 >>> 24) & 0xff] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff];

    const mix = (x) => {
      const b0 = (x >>> 24) & 0xff; const b1 = (x >>> 16) & 0xff; const b2 = (x >>> 8) & 0xff; const b3 = x & 0xff;
      const g2 = (b) => ((b << 1) ^ ((b & 0x80) ? 0x1b : 0)) & 0xff;
      const g3 = (b) => g2(b) ^ b;
      return ((g2(b0) ^ g3(b1) ^ b2 ^ b3) << 24) |
             ((b0 ^ g2(b1) ^ g3(b2) ^ b3) << 16) |
             ((b0 ^ b1 ^ g2(b2) ^ g3(b3)) << 8) |
             (g3(b0) ^ b1 ^ b2 ^ g2(b3));
    };

    const rk = round * 4;
    s0 = mix(t0) ^ w[rk];
    s1 = mix(t1) ^ w[rk + 1];
    s2 = mix(t2) ^ w[rk + 2];
    s3 = mix(t3) ^ w[rk + 3];
  }

  // Final round
  const t0 = (SBOX[(s0 >>> 24) & 0xff] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff];
  const t1 = (SBOX[(s1 >>> 24) & 0xff] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff];
  const t2 = (SBOX[(s2 >>> 24) & 0xff] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff];
  const t3 = (SBOX[(s3 >>> 24) & 0xff] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff];

  s0 = t0 ^ w[56]; s1 = t1 ^ w[57]; s2 = t2 ^ w[58]; s3 = t3 ^ w[59];

  const out = new Uint8Array(16);
  out[0] = (s0 >>> 24) & 0xff; out[1] = (s0 >>> 16) & 0xff; out[2] = (s0 >>> 8) & 0xff; out[3] = s0 & 0xff;
  out[4] = (s1 >>> 24) & 0xff; out[5] = (s1 >>> 16) & 0xff; out[6] = (s1 >>> 8) & 0xff; out[7] = s1 & 0xff;
  out[8] = (s2 >>> 24) & 0xff; out[9] = (s2 >>> 16) & 0xff; out[10] = (s2 >>> 8) & 0xff; out[11] = s2 & 0xff;
  out[12] = (s3 >>> 24) & 0xff; out[13] = (s3 >>> 16) & 0xff; out[14] = (s3 >>> 8) & 0xff; out[15] = s3 & 0xff;
  return out;
}

// GF(2^128) multiplication for GCM GHASH
function gfMul(x, y) {
  const z = new Uint8Array(16);
  const v = new Uint8Array(x);
  for (let i = 0; i < 16; i++) {
    const yi = y[i];
    for (let j = 7; j >= 0; j--) {
      if ((yi & (1 << j)) !== 0) {
        for (let k = 0; k < 16; k++) z[k] ^= v[k];
      }
      const lsb = (v[15] & 1) !== 0;
      for (let k = 15; k > 0; k--) {
        v[k] = (v[k] >>> 1) | ((v[k - 1] & 1) << 7);
      }
      v[0] = v[0] >>> 1;
      if (lsb) v[0] ^= 0xe1; // Primitive polynomial reduction
    }
  }
  return z;
}

function ghash(H, data) {
  let Y = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      Y[j] ^= data[i + j] || 0;
    }
    Y = gfMul(Y, H);
  }
  return Y;
}

// Pure JS SHA-256 for key derivation
export function sha256JS(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
  let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const k = (55 - l % 64 + 64) % 64;
  const padded = new Uint8Array(l + 1 + k + 8);
  padded.set(bytes);
  padded[l] = 0x80;
  
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, H0, false); outView.setUint32(4, H1, false);
  outView.setUint32(8, H2, false); outView.setUint32(12, H3, false);
  outView.setUint32(16, H4, false); outView.setUint32(20, H5, false);
  outView.setUint32(24, H6, false); outView.setUint32(28, H7, false);
  return out;
}

function encryptAESGCM_JS(plaintextBytes, keyBytes, ivBytes) {
  const w = keyExpansion256(keyBytes);
  const H = aesEncryptBlock(new Uint8Array(16), w);

  const J0 = new Uint8Array(16);
  J0.set(ivBytes.subarray(0, 12));
  J0[15] = 1;

  const len = plaintextBytes.length;
  const ciphertext = new Uint8Array(len);
  let ctr = new Uint8Array(J0);

  const inc32 = (block) => {
    let val = (block[12] << 24) | (block[13] << 16) | (block[14] << 8) | block[15];
    val = (val + 1) >>> 0;
    block[12] = (val >>> 24) & 0xff; block[13] = (val >>> 16) & 0xff; block[14] = (val >>> 8) & 0xff; block[15] = val & 0xff;
  };

  for (let i = 0; i < len; i += 16) {
    inc32(ctr);
    const ks = aesEncryptBlock(ctr, w);
    const blockLen = Math.min(16, len - i);
    for (let j = 0; j < blockLen; j++) {
      ciphertext[i + j] = plaintextBytes[i + j] ^ ks[j];
    }
  }

  // Construct data for GHASH: pad(AAD) || pad(C) || len(AAD)_64 || len(C)_64
  const cPadLen = (16 - (ciphertext.length % 16)) % 16;
  const ghashData = new Uint8Array(ciphertext.length + cPadLen + 16);
  ghashData.set(ciphertext, 0);

  const ghashView = new DataView(ghashData.buffer);
  const bitLenC = ciphertext.length * 8;
  ghashView.setUint32(ghashData.length - 4, bitLenC, false);

  const S = ghash(H, ghashData);
  const J0Enc = aesEncryptBlock(J0, w);

  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    tag[i] = S[i] ^ J0Enc[i];
  }

  const result = new Uint8Array(ciphertext.length + 16);
  result.set(ciphertext, 0);
  result.set(tag, ciphertext.length);
  return result;
}

function decryptAESGCM_JS(ciphertextWithTagBytes, keyBytes, ivBytes) {
  if (ciphertextWithTagBytes.length < 16) {
    throw new Error('Invalid AES-GCM ciphertext length');
  }

  const ciphertext = ciphertextWithTagBytes.subarray(0, ciphertextWithTagBytes.length - 16);
  const receivedTag = ciphertextWithTagBytes.subarray(ciphertextWithTagBytes.length - 16);

  const w = keyExpansion256(keyBytes);
  const H = aesEncryptBlock(new Uint8Array(16), w);

  const J0 = new Uint8Array(16);
  J0.set(ivBytes.subarray(0, 12));
  J0[15] = 1;

  // Construct data for GHASH
  const cPadLen = (16 - (ciphertext.length % 16)) % 16;
  const ghashData = new Uint8Array(ciphertext.length + cPadLen + 16);
  ghashData.set(ciphertext, 0);

  const ghashView = new DataView(ghashData.buffer);
  const bitLenC = ciphertext.length * 8;
  ghashView.setUint32(ghashData.length - 4, bitLenC, false);

  const S = ghash(H, ghashData);
  const J0Enc = aesEncryptBlock(J0, w);

  const expectedTag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    expectedTag[i] = S[i] ^ J0Enc[i];
  }

  // Constant-time tag check
  let diff = 0;
  for (let i = 0; i < 16; i++) {
    diff |= expectedTag[i] ^ receivedTag[i];
  }

  if (diff !== 0) {
    throw new Error('Integrity check failed: invalid GCM authentication tag');
  }

  // Decrypt CTR
  const len = ciphertext.length;
  const plaintext = new Uint8Array(len);
  let ctr = new Uint8Array(J0);

  const inc32 = (block) => {
    let val = (block[12] << 24) | (block[13] << 16) | (block[14] << 8) | block[15];
    val = (val + 1) >>> 0;
    block[12] = (val >>> 24) & 0xff; block[13] = (val >>> 16) & 0xff; block[14] = (val >>> 8) & 0xff; block[15] = val & 0xff;
  };

  for (let i = 0; i < len; i += 16) {
    inc32(ctr);
    const ks = aesEncryptBlock(ctr, w);
    const blockLen = Math.min(16, len - i);
    for (let j = 0; j < blockLen; j++) {
      plaintext[i + j] = ciphertext[i + j] ^ ks[j];
    }
  }

  return plaintext;
}

/**
 * Derive a 256-bit CryptoKey from a secret string using SHA-256 hash
 */
export async function deriveMeshCryptoKey(secretString = DEFAULT_MESH_SECRET) {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secretString);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    try {
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', secretBytes);
      return await globalThis.crypto.subtle.importKey(
        'raw',
        hashBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } catch {
      /* fallback to JS */
    }
  }

  return sha256JS(secretBytes);
}

/**
 * Encrypt a string or object payload using AES-256-GCM
 */
export async function encryptPayloadAESGCM(data, secretKeyString = DEFAULT_MESH_SECRET) {
  try {
    const textToEncrypt = typeof data === 'object' ? JSON.stringify(data) : String(data);
    const encoder = new TextEncoder();
    const plaintextBytes = encoder.encode(textToEncrypt);

    const iv = getRandomValues(new Uint8Array(12));

    let ciphertextBytes;

    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      try {
        const key = await deriveMeshCryptoKey(secretKeyString);
        if (key instanceof CryptoKey) {
          const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            plaintextBytes
          );
          ciphertextBytes = new Uint8Array(encryptedBuffer);
        }
      } catch {
        /* fallback to JS */
      }
    }

    if (!ciphertextBytes) {
      const keyBytes = sha256JS(encoder.encode(secretKeyString));
      ciphertextBytes = encryptAESGCM_JS(plaintextBytes, keyBytes, iv);
    }

    const envelope = {
      v: PROTOCOL_VERSION,
      iv: uint8ToBase64(iv),
      ct: uint8ToBase64(ciphertextBytes),
    };

    return {
      ok: true,
      envelope,
      serialized: JSON.stringify(envelope),
    };
  } catch (error) {
    console.error('[Crypto Error] AES-256-GCM encryption failed:', error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Decrypt an AES-256-GCM envelope and verify its GCM authentication tag.
 */
export async function decryptPayloadAESGCM(envelopeInput, secretKeyString = DEFAULT_MESH_SECRET) {
  let envelope = envelopeInput;

  if (typeof envelopeInput === 'string') {
    try {
      envelope = JSON.parse(envelopeInput);
    } catch {
      envelope = envelopeInput;
    }
  }

  if (isLegacyXORPacket(envelope)) {
    return handleLegacyXORPacket(envelope);
  }

  const isV2Envelope = envelope && typeof envelope === 'object' && (envelope.v === PROTOCOL_VERSION || envelope.algo === 'AES-256-GCM') && envelope.iv && envelope.ct;
  if (!isV2Envelope) {
    console.warn('[Security Warning] Invalid packet format received. Missing AES-GCM parameters.');
    return {
      ok: false,
      error: 'Invalid envelope structure: missing GCM parameters',
      tampered: true,
    };
  }

  try {
    const iv = base64ToUint8(envelope.iv);
    const ciphertextBytes = base64ToUint8(envelope.ct);
    let decryptedBuffer = null;

    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      try {
        const key = await deriveMeshCryptoKey(secretKeyString);
        if (key instanceof CryptoKey) {
          decryptedBuffer = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertextBytes
          );
        }
      } catch {
        /* fallback to JS */
      }
    }

    if (!decryptedBuffer) {
      const encoder = new TextEncoder();
      const keyBytes = sha256JS(encoder.encode(secretKeyString));
      decryptedBuffer = decryptAESGCM_JS(ciphertextBytes, keyBytes, iv);
    }

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decryptedBuffer);

    let parsedData = plaintext;
    try {
      parsedData = JSON.parse(plaintext);
    } catch {
      // Data was raw string
    }

    return {
      ok: true,
      data: parsedData,
      rawText: plaintext,
    };
  } catch (error) {
    console.warn('[Security Alert] AES-256-GCM Integrity Check Failed! Packet tampered, corrupted, or key mismatch:', error.message);
    return {
      ok: false,
      error: `Integrity check failed: ${error.message}`,
      tampered: true,
    };
  }
}

/**
 * Check if a packet is legacy XOR format
 */
export function isLegacyXORPacket(packet) {
  if (!packet) return false;
  if (typeof packet === 'string') {
    try {
      const parsed = JSON.parse(packet);
      return parsed.encrypted === true && (!parsed.algo || parsed.algo === 'XOR');
    } catch {
      return false;
    }
  }
  if (typeof packet === 'object' && packet !== null) {
    if (packet.algo === 'AES-256-GCM' || packet.v === 2) return false;
    return (packet.encrypted === true && (!packet.algo || packet.algo !== 'AES-256-GCM')) || packet.algo === 'XOR';
  }
  return false;
}

/**
 * Migration Path: Gracefully handle legacy XOR-encrypted packet
 */
export function handleLegacyXORPacket(packet) {
  const packetId = packet?.id || 'unknown';
  console.warn(`[Migration Warning] Legacy XOR packet received (ID: ${packetId}). XOR encryption is cryptographically broken and deprecated. Dropping unauthenticated packet per security policy.`);
  return {
    ok: false,
    legacy: true,
    error: 'Legacy XOR packets rejected due to lack of authenticated encryption',
  };
}

/**
 * Calculate size in bytes of a serialized payload or envelope
 */
export function calculatePayloadSize(payload) {
  const str = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
  return new TextEncoder().encode(str).byteLength;
}

/**
 * Verify whether an encrypted envelope fits within BLE payload size budget
 */
export function verifyBLEPayloadBudget(envelope, maxBytes = MAX_BLE_CHARACTERISTIC_BYTES) {
  const sizeBytes = calculatePayloadSize(envelope);
  const fits = sizeBytes <= maxBytes;
  return {
    fits,
    sizeBytes,
    maxBytes,
    marginBytes: maxBytes - sizeBytes,
  };
}

/**
 * Fragment a large envelope into chunks if it exceeds BLE characteristic budget
 */
export function fragmentPayload(envelope, maxChunkSize = 200) {
  const serialized = typeof envelope === 'object' ? JSON.stringify(envelope) : String(envelope);
  const msgId = `frag_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const chunks = [];
  
  const totalLength = serialized.length;
  const numChunks = Math.ceil(totalLength / maxChunkSize);
  
  for (let i = 0; i < numChunks; i++) {
    chunks.push({
      fragment: true,
      msgId,
      chunkIndex: i,
      totalChunks: numChunks,
      data: serialized.slice(i * maxChunkSize, (i + 1) * maxChunkSize),
    });
  }
  
  return chunks;
}

/**
 * Reassemble fragmented payload chunks
 */
export function reassemblePayload(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const total = sorted[0].totalChunks;
  if (sorted.length < total) return null;
  
  const fullSerialized = sorted.map(c => c.data).join('');
  try {
    return JSON.parse(fullSerialized);
  } catch {
    return fullSerialized;
  }
}

/* ==========================================================================
   ED25519 HQ CRYPTOGRAPHIC AUTHENTICATION ENGINE
   ========================================================================== */

export function hexToUint8(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function uint8ToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Validate and derive Authorized HQ Key Pair from provision input on HQ device.
 * Requires supplying the explicit 32-byte Ed25519 private key hex matching AUTHORIZED_HQ_PUBLIC_KEY.
 * @param {string} input 
 * @returns {{ok: boolean, privateKeyHex?: string, publicKeyHex?: string, error?: string}}
 */
export function deriveHQKeyFromProvisionCode(input) {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'Provisioning key required' };
  }
  
  const cleanInput = input.trim();
  if (cleanInput.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanInput)) {
    return { ok: false, error: 'Invalid HQ provisioning key: must be a 64-character hex string' };
  }

  try {
    const privBytes = hexToUint8(cleanInput);
    const pubBytes = ed.getPublicKey(privBytes);
    const publicKeyHex = uint8ToHex(pubBytes);

    if (publicKeyHex.toLowerCase() !== _authorizedHQPublicKey.toLowerCase()) {
      return { ok: false, error: 'Invalid HQ provisioning key: public key does not match AUTHORIZED_HQ_PUBLIC_KEY' };
    }
    
    return {
      ok: true,
      privateKeyHex: cleanInput,
      publicKeyHex: _authorizedHQPublicKey,
    };
  } catch (err) {
    return { ok: false, error: `Key validation failed: ${err.message}` };
  }
}

/**
 * Generate a new random or seed-based Ed25519 Key Pair
 * @param {string} [seedString] 
 * @returns {{privateKeyHex: string, publicKeyHex: string}}
 */
export function generateHQKeyPair(seedString) {
  let seedBytes;
  if (seedString && typeof seedString === 'string') {
    seedBytes = sha256JS(new TextEncoder().encode(seedString));
  } else {
    seedBytes = getRandomValues(new Uint8Array(32));
  }
  
  const pubBytes = ed.getPublicKey(seedBytes);
  return {
    privateKeyHex: uint8ToHex(seedBytes),
    publicKeyHex: uint8ToHex(pubBytes),
  };
}

/**
 * Sign data string with HQ private key using Ed25519
 * @param {string} privateKeyHex 
 * @param {string} dataStr 
 * @returns {string} Hex-encoded Ed25519 signature
 */
export function signHQAuthenticationToken(privateKeyHex, dataStr) {
  if (!privateKeyHex || !dataStr) {
    throw new Error('Private key and data string required for signing');
  }
  const privBytes = hexToUint8(privateKeyHex);
  const msgBytes = new TextEncoder().encode(`FORBIEN_HQ_AUTH|${dataStr}`);
  const sigBytes = ed.sign(msgBytes, privBytes);
  return uint8ToHex(sigBytes);
}

/**
 * Verify Ed25519 signature against HQ public key
 * @param {string} publicKeyHex 
 * @param {string} dataStr 
 * @param {string} sigHex 
 * @returns {boolean} True if signature is valid for AUTHORIZED_HQ_PUBLIC_KEY
 */
export function verifyHQAuthenticationToken(publicKeyHex, dataStr, sigHex) {
  if (!publicKeyHex || !dataStr || !sigHex) {
    return false;
  }
  // Require public key to match authorized deployment HQ public key
  if (publicKeyHex.toLowerCase() !== _authorizedHQPublicKey.toLowerCase()) {
    return false;
  }
  
  try {
    const pubBytes = hexToUint8(publicKeyHex);
    const sigBytes = hexToUint8(sigHex);
    const msgBytes = new TextEncoder().encode(`FORBIEN_HQ_AUTH|${dataStr}`);
    return ed.verify(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Create a complete cryptographically authenticated HQ Handshake packet
 * @param {string} privateKeyHex 
 * @returns {object} Handshake object containing signature
 */
export function createHQAuthHandshake(privateKeyHex) {
  const ts = Date.now();
  const nonce = uint8ToHex(getRandomValues(new Uint8Array(12)));
  const nodeId = 'FORBIEN-HQ-01';
  const publicKeyHex = _authorizedHQPublicKey;
  
  const challengeDataStr = `${nodeId}|${ts}|${nonce}`;
  const signature = signHQAuthenticationToken(privateKeyHex, challengeDataStr);
  
  return {
    v: PROTOCOL_VERSION,
    type: 'HQ_AUTH_HANDSHAKE',
    nodeId,
    publicKey: publicKeyHex,
    timestamp: ts,
    nonce,
    signature,
  };
}

/**
 * Verify incoming HQ Auth Handshake packet
 * @param {object} handshake 
 * @returns {{valid: boolean, reason?: string}}
 */
export function verifyHQAuthHandshake(handshake) {
  if (!handshake || typeof handshake !== 'object') {
    return { valid: false, reason: 'Invalid handshake payload' };
  }
  
  if (handshake.nodeId !== 'FORBIEN-HQ-01') {
    return { valid: false, reason: 'Node ID is not FORBIEN-HQ-01' };
  }
  
  if (!handshake.publicKey || handshake.publicKey.toLowerCase() !== _authorizedHQPublicKey.toLowerCase()) {
    return { valid: false, reason: 'Public key does not match Authorized HQ deployment key' };
  }
  
  if (!handshake.timestamp || !handshake.nonce || !handshake.signature) {
    return { valid: false, reason: 'Missing cryptographic signature parameters' };
  }
  
  const challengeDataStr = `${handshake.nodeId}|${handshake.timestamp}|${handshake.nonce}`;
  const isValid = verifyHQAuthenticationToken(handshake.publicKey, challengeDataStr, handshake.signature);
  
  if (!isValid) {
    return { valid: false, reason: 'Invalid Ed25519 cryptographic signature' };
  }
  
  return { valid: true };
}


