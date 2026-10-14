import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { env, MIN_SECRET_LENGTH } from "./env";
import { files, readJson, updateJson } from "./store";
import { ipHash, safeEqual } from "./security";
import { enrollment, generateSecret, verifyCode } from "./totp";
import type { Role, SessionUser } from "@/types";

/**
 * Accounts and sessions.
 * A session is valid only when BOTH the signed cookie verifies AND its id is still in
 * runtime-sessions.json, so revoking a session takes effect immediately.
 */
export const SESSION_COOKIE = "hc_session";
const SESSION_HOURS = 12;

type UserRecord = {
  username: string;
  /** Absent for accounts that can only sign in with an authenticator. */
  passwordHash?: string;
  role: Role;
  createdAt: string;
  disabled?: boolean;
  /** Base32 TOTP secret once the authenticator is enrolled. */
  totpSecret?: string;
  /** Last accepted time step; codes at or before it are rejected (replay protection). */
  totpStep?: number;
  /** Secret shown in the QR code but not confirmed yet. */
  totpPending?: string;
};
type SessionRecord = { id: string; username: string; role: Role; ipHash: string; createdAt: string; expiresAt: string };
export type PublicUser = Pick<UserRecord, "username" | "role" | "disabled" | "createdAt"> & { totp: boolean; managedByEnv: boolean };

function signingKey() {
  const value = env().SESSION_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return new TextEncoder().encode(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, encoded: string | undefined) {
  const [, salt, hex] = encoded?.split(":") ?? [];
  if (!salt || !hex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The account whose password BOOTSTRAP_ADMIN_PASSWORD controls, while that variable is set. */
function envAccount() {
  const { BOOTSTRAP_ADMIN_USERNAME: username, BOOTSTRAP_ADMIN_PASSWORD: password } = env();
  return username && password ? { username, password } : null;
}

export const isEnvManaged = (username: string) => envAccount()?.username === username;

export const toPublicUser = (user: UserRecord): PublicUser => ({
  username: user.username, role: user.role, disabled: user.disabled, createdAt: user.createdAt,
  totp: Boolean(user.totpSecret), managedByEnv: isEnvManaged(user.username),
});

/** Returns all users. While BOOTSTRAP_ADMIN_* is set, that admin always exists. */
export async function listUsers() {
  const users = await readJson<UserRecord[]>(files.users, []);
  const bootstrap = envAccount();
  if (!bootstrap || users.some((user) => user.username === bootstrap.username)) return users;
  return updateJson<UserRecord[]>(files.users, [], (current) => current.some((user) => user.username === bootstrap.username)
    ? current
    : [...current, { username: bootstrap.username, passwordHash: hashPassword(bootstrap.password), role: "admin", createdAt: new Date().toISOString() }]);
}

async function findUser(username: string) {
  return (await listUsers()).find((item) => item.username === username && !item.disabled) ?? null;
}

function updateUser(username: string, change: (user: UserRecord) => UserRecord) {
  return updateJson<UserRecord[]>(files.users, [], (users) => users.map((user) => user.username === username ? change(user) : user));
}

/**
 * Password check. BOOTSTRAP_ADMIN_PASSWORD wins for its account (so editing the env file works);
 * the stored hash follows it, so removing the variable later keeps the last password.
 */
async function checkPassword(user: UserRecord, password: string) {
  const bootstrap = envAccount();
  if (bootstrap?.username === user.username) {
    if (!safeEqual(password, bootstrap.password)) return false;
    if (!passwordMatches(password, user.passwordHash)) await updateUser(user.username, (record) => ({ ...record, passwordHash: hashPassword(password) }));
    return true;
  }
  return passwordMatches(password, user.passwordHash);
}

export const authMethod = () => env().AUTH_METHOD;

export type LoginResult = { user: UserRecord } | { setupRequired: true } | null;

/** AUTH_METHOD=password: username + password. AUTH_METHOD=totp: username + code, or setup when not enrolled. */
export async function authenticate(input: { username: string; password?: string; code?: string }): Promise<LoginResult> {
  const user = await findUser(input.username);
  if (authMethod() === "password") {
    // Hash anyway for unknown users so response time does not reveal which usernames exist.
    if (!user) { passwordMatches(input.password ?? "", `scrypt:00:${"0".repeat(128)}`); return null; }
    return input.password && await checkPassword(user, input.password) ? { user } : null;
  }
  if (!user) return null;
  if (!user.totpSecret) return { setupRequired: true };
  const step = input.code ? verifyCode(user.totpSecret, input.code, user.totpStep) : null;
  if (step === null) return null;
  await updateUser(user.username, (record) => ({ ...record, totpStep: step }));
  return { user };
}

// ── authenticator enrolment ──────────────────────────────────────────────────
// Starting enrolment stores a pending secret and hands out a 10-minute ticket bound to it;
// confirming with a valid code from the new secret activates it. Purpose "setup" signs the
// user in afterwards; "renew" replaces the secret for an already signed-in user.
type TicketPurpose = "setup" | "renew";
const TICKET_MINUTES = 10;
const fingerprint = (secret: string) => createHash("sha256").update(secret).digest("base64url").slice(0, 16);

async function beginEnrollment(user: UserRecord, purpose: TicketPurpose) {
  const secret = generateSecret();
  await updateUser(user.username, (record) => ({ ...record, totpPending: secret }));
  const ticket = await new SignJWT({ purpose, pf: fingerprint(secret) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.username)
    .setIssuedAt()
    .setExpirationTime(`${TICKET_MINUTES}m`)
    .sign(signingKey());
  return { ticket, ...(await enrollment(user.username, secret)) };
}

/** First sign-in in totp mode: the password (env bootstrap or launch.sh --reset-user) proves who is enrolling. */
export async function startSetup(username: string, password: string) {
  const user = await findUser(username);
  if (!user || user.totpSecret || !(await checkPassword(user, password))) return null;
  return beginEnrollment(user, "setup");
}

/** Signed-in renewal: the current code proves the old authenticator is still in hand. */
export async function startRenewal(username: string, code: string) {
  const user = await findUser(username);
  if (!user) return null;
  if (user.totpSecret) {
    const step = verifyCode(user.totpSecret, code, user.totpStep);
    if (step === null) return null;
    await updateUser(username, (record) => ({ ...record, totpStep: step }));
  }
  return beginEnrollment(user, "renew");
}

export async function finishEnrollment(ticket: string, code: string, expected: TicketPurpose, sessionUser?: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(ticket, signingKey()));
  } catch {
    return null;
  }
  if (payload.purpose !== expected || !payload.sub || (expected === "renew" && payload.sub !== sessionUser)) return null;
  const user = await findUser(payload.sub);
  if (!user?.totpPending || fingerprint(user.totpPending) !== payload.pf) return null;
  if (expected === "setup" && user.totpSecret) return null;
  const step = verifyCode(user.totpPending, code);
  if (step === null) return null;
  const pending = user.totpPending;
  await updateUser(user.username, (record) => ({ ...record, totpSecret: pending, totpStep: step, totpPending: undefined }));
  return user;
}

export async function upsertUser(input: { username: string; password?: string; role: Role; disabled?: boolean }) {
  await listUsers();
  if (input.password && isEnvManaged(input.username)) throw new Error("该账号的密码由 BOOTSTRAP_ADMIN_PASSWORD 管理；请修改环境文件，或删除该变量后再在此处改密");
  const users = await updateJson<UserRecord[]>(files.users, [], (current) => {
    const index = current.findIndex((user) => user.username === input.username);
    if (index < 0) {
      if (!input.password) throw new Error("新账号必须设置密码");
      return [...current, { username: input.username, passwordHash: hashPassword(input.password), role: input.role, disabled: input.disabled, createdAt: new Date().toISOString() }];
    }
    const next = [...current];
    next[index] = { ...next[index], role: input.role, disabled: input.disabled, passwordHash: input.password ? hashPassword(input.password) : next[index].passwordHash };
    return next;
  });
  return users.map(toPublicUser);
}

export async function removeUser(username: string) {
  if (isEnvManaged(username)) throw new Error("该账号由 BOOTSTRAP_ADMIN_* 管理；先从环境文件删除这两个变量");
  await updateJson<UserRecord[]>(files.users, [], (users) => {
    const activeAdmins = users.filter((user) => user.role === "admin" && !user.disabled);
    if (activeAdmins.length <= 1 && users.find((user) => user.username === username)?.role === "admin") throw new Error("必须保留至少一个管理员");
    return users.filter((user) => user.username !== username);
  });
  await updateJson<SessionRecord[]>(files.sessions, [], (sessions) => sessions.filter((session) => session.username !== username));
}

/** Account-security summary for the signed-in user. */
export async function accountStatus(username: string) {
  const user = await findUser(username);
  return { method: authMethod(), totp: Boolean(user?.totpSecret) };
}

export async function createSession(user: { username: string; role: Role }, ip: string) {
  const id = randomBytes(18).toString("base64url");
  const now = Date.now();
  await updateJson<SessionRecord[]>(files.sessions, [], (sessions) => [
    ...sessions.filter((session) => new Date(session.expiresAt).getTime() > now),
    { id, username: user.username, role: user.role, ipHash: ipHash(ip), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_HOURS * 3_600_000).toISOString() },
  ]);
  const token = await new SignJWT({ role: user.role, sid: id, iph: ipHash(ip) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(signingKey());
  return { token, id, maxAge: SESSION_HOURS * 3600 };
}

/** JSON response that also carries the new session cookie. */
export async function signedInResponse(user: { username: string; role: Role }, ip: string) {
  const session = await createSession(user, ip);
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "strict", secure: env().COOKIE_SECURE, path: "/", maxAge: session.maxAge });
  return response;
}

/** Resolve the caller's session; `ip` binds the session to the address it was created from. */
export async function readSession(ip?: string): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey());
    if (!payload.sub || !payload.sid || (payload.role !== "admin" && payload.role !== "viewer")) return null;
    if (ip && payload.iph !== ipHash(ip)) return null;
    const sessions = await readJson<SessionRecord[]>(files.sessions, []);
    const match = sessions.find((session) => session.id === payload.sid && session.username === payload.sub && new Date(session.expiresAt) > new Date());
    return match ? { username: match.username, role: match.role, sessionId: match.id } : null;
  } catch {
    return null;
  }
}

export function listSessions() {
  return readJson<SessionRecord[]>(files.sessions, []);
}

export function revokeSession(id: string) {
  return updateJson<SessionRecord[]>(files.sessions, [], (sessions) => sessions.filter((session) => session.id !== id));
}

