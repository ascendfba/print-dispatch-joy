// Device trust + 4-digit PIN sign-in.
//
// We store, per signed-in account, an entry in localStorage holding the
// Supabase session encrypted with a key derived from the user's 4-digit PIN
// via PBKDF2 (SHA-256, 200k iterations) -> AES-GCM 256.
//
// The PIN itself is never stored. AES-GCM authentication implicitly verifies
// the PIN: a wrong PIN derives a wrong key and decryption throws.
//
// Trust expires 30 days after sign-in. Expired entries are ignored and
// removed on access.

const STORAGE_KEY = "ascend.deviceTrust.v1";
const LOCK_KEY = "ascend.deviceTrust.lockedEmail.v1";
const TRUST_DAYS = 30;
const PBKDF2_ITERS = 200_000;

export type TrustedDevice = {
  email: string;
  userId: string;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  trustedUntil: number; // epoch ms
};

type StoredSession = {
  access_token: string;
  refresh_token: string;
};

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readAll(): TrustedDevice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrustedDevice[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: TrustedDevice[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function pruneExpired(entries: TrustedDevice[]): TrustedDevice[] {
  const now = Date.now();
  const kept = entries.filter((e) => e.trustedUntil > now);
  if (kept.length !== entries.length) writeAll(kept);
  return kept;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidPin(pin: string) {
  return /^\d{4}$/.test(pin);
}

export const deviceTrust = {
  list(): TrustedDevice[] {
    return pruneExpired(readAll());
  },

  findByEmail(email: string): TrustedDevice | null {
    const e = normalizeEmail(email);
    return this.list().find((d) => d.email === e) ?? null;
  },

  hasAny(): boolean {
    return this.list().length > 0;
  },

  async save(params: {
    email: string;
    userId: string;
    pin: string;
    session: StoredSession;
  }): Promise<void> {
    if (!isValidPin(params.pin)) throw new Error("PIN must be 4 digits");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(params.pin, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(params.session));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    );
    const entry: TrustedDevice = {
      email: normalizeEmail(params.email),
      userId: params.userId,
      salt: b64encode(salt),
      iv: b64encode(iv),
      ciphertext: b64encode(ct),
      trustedUntil: Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000,
    };
    const others = readAll().filter((e) => e.email !== entry.email);
    writeAll([entry, ...others]);
  },

  async unlock(email: string, pin: string): Promise<StoredSession> {
    if (!isValidPin(pin)) throw new Error("PIN must be 4 digits");
    const entry = this.findByEmail(email);
    if (!entry) throw new Error("No trusted PIN on this device");
    const key = await deriveKey(pin, b64decode(entry.salt));
    try {
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64decode(entry.iv) as BufferSource },
        key,
        b64decode(entry.ciphertext) as BufferSource,
      );
      return JSON.parse(new TextDecoder().decode(pt)) as StoredSession;
    } catch {
      throw new Error("Incorrect PIN");
    }
  },

  remove(email: string): void {
    const e = normalizeEmail(email);
    writeAll(readAll().filter((d) => d.email !== e));
  },

  removeAll(): void {
    writeAll([]);
    this.clearLock();
  },

  lock(email: string): void {
    if (typeof window === "undefined") return;
    const entry = this.findByEmail(email);
    if (entry) window.localStorage.setItem(LOCK_KEY, entry.email);
  },

  lockedEmail(): string | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const email = normalizeEmail(raw);
    if (this.findByEmail(email)) return email;
    window.localStorage.removeItem(LOCK_KEY);
    return null;
  },

  isLocked(email?: string | null): boolean {
    const locked = this.lockedEmail();
    if (!locked) return false;
    return email ? locked === normalizeEmail(email) : true;
  },

  clearLock(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LOCK_KEY);
  },

  trustDays: TRUST_DAYS,
};
