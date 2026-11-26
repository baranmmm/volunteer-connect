// Minimal NIST P-256 arithmetic (BigInt), used only to derive the public point of the VAPID private key: Web Crypto
// cannot import an EC private key without its public coordinates (JWK needs x and y), and no P-256 library is a
// dependency. Jacobian coordinates, one inversion at the end. Not constant-time: it runs once per server isolate on the
// server's own key (no attacker-chosen input, no timing exposed to a caller). Tested against Node's crypto and known
// vectors (src/test/web-push.test.ts).

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

type Jacobian = { x: bigint; y: bigint; z: bigint };
const INFINITY: Jacobian = { x: 1n, y: 1n, z: 0n };

const mod = (a: bigint) => {
  const r = a % P;
  return r < 0n ? r + P : r;
};

function inverse(a: bigint): bigint {
  // Extended Euclid on (a mod p, p).
  let [r0, r1] = [mod(a), P];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(s0);
}

function double(p: Jacobian): Jacobian {
  if (p.z === 0n || p.y === 0n) return INFINITY;
  // a = -3: dbl-2001-b.
  const delta = mod(p.z * p.z);
  const gamma = mod(p.y * p.y);
  const beta = mod(p.x * gamma);
  const alpha = mod(3n * (p.x - delta) * (p.x + delta));
  const x = mod(alpha * alpha - 8n * beta);
  const z = mod((p.y + p.z) * (p.y + p.z) - gamma - delta);
  const y = mod(alpha * (4n * beta - x) - 8n * gamma * gamma);
  return { x, y, z };
}

function add(p: Jacobian, q: Jacobian): Jacobian {
  if (p.z === 0n) return q;
  if (q.z === 0n) return p;
  // add-2007-bl.
  const z1z1 = mod(p.z * p.z);
  const z2z2 = mod(q.z * q.z);
  const u1 = mod(p.x * z2z2);
  const u2 = mod(q.x * z1z1);
  const s1 = mod(p.y * q.z * z2z2);
  const s2 = mod(q.y * p.z * z1z1);
  const h = mod(u2 - u1);
  const r = mod(2n * (s2 - s1));
  if (h === 0n) return r === 0n ? double(p) : INFINITY;
  const i = mod(4n * h * h);
  const j = mod(h * i);
  const v = mod(u1 * i);
  const x = mod(r * r - j - 2n * v);
  const y = mod(r * (v - x) - 2n * s1 * j);
  const z = mod(((p.z + q.z) * (p.z + q.z) - z1z1 - z2z2) * h);
  return { x, y, z };
}

const toBigInt = (bytes: Uint8Array) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
};
const toBytes32 = (n: bigint) => {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

/** Whether (x, y) is on the curve (y² = x³ − 3x + b mod p). */
export function isOnCurve(x: bigint, y: bigint): boolean {
  if (x < 0n || x >= P || y < 0n || y >= P) return false;
  return mod(y * y) === mod(x * x * x - 3n * x + B);
}

/**
 * The public point d·G of a 32-byte private scalar as the 65-byte uncompressed encoding (0x04 ‖ x ‖ y). Throws for a
 * scalar outside [1, n − 1].
 */
export function p256PublicKey(privateKey: Uint8Array): Uint8Array<ArrayBuffer> {
  if (privateKey.length !== 32) throw new Error("P-256 private key must be 32 bytes");
  const d = toBigInt(privateKey);
  if (d <= 0n || d >= N) throw new Error("P-256 private key out of range");
  let result = INFINITY;
  const g: Jacobian = { x: GX, y: GY, z: 1n };
  for (let bit = 255; bit >= 0; bit--) {
    result = double(result);
    if ((d >> BigInt(bit)) & 1n) result = add(result, g);
  }
  if (result.z === 0n) throw new Error("P-256 private key out of range");
  const zi = inverse(result.z);
  const zi2 = mod(zi * zi);
  const x = mod(result.x * zi2);
  const y = mod(result.y * zi2 * zi);
  if (!isOnCurve(x, y)) throw new Error("P-256 arithmetic error");
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(toBytes32(x), 1);
  out.set(toBytes32(y), 33);
  return out;
}
