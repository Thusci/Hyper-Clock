import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { safeEqual } from "./security";

/**
 * RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), the format every
 * authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …) understands.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next step too, so a phone clock that is a few seconds off still works. */
const WINDOW = 1;
const ISSUER = "Hyper Clock";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text: string) {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret() {
  return base32Encode(randomBytes(20));
}

function codeAt(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Returns the matched time step, or null. Callers store the step and pass it back as `lastStep`
 * so a code that was already used (e.g. read over someone's shoulder) cannot be replayed.
 */
export function verifyCode(secret: string, code: string, lastStep = -1, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (step > lastStep && safeEqual(codeAt(secret, step), clean)) return step;
  }
  return null;
}

export async function enrollment(username: string, secret: string) {
  const label = encodeURIComponent(`${ISSUER}:${username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
  // Grouped for manual entry when the camera cannot read the screen.
  return { uri, secret: secret.match(/.{1,4}/g)?.join(" ") ?? secret, qrSvg };
}
