import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env, MIN_SECRET_LENGTH } from "./env";
import { files, readJson, updateJson } from "./store";
import { ipHash } from "./security";
import type { Role, SessionUser } from "@/types";

/**
 * Accounts and sessions.
 * A session is valid only when BOTH the signed cookie verifies AND its id is still in
 * runtime-sessions.json, so revoking a session takes effect immediately.
 */
export const SESSION_COOKIE = "hc_session";
const SESSION_HOURS = 12;

type UserRecord = { username: string; passwordHash: string; role: Role; createdAt: string; disabled?: boolean };
type SessionRecord = { id: string; username: string; role: Role; ipHash: string; createdAt: string; expiresAt: string };
export type PublicUser = Pick<UserRecord, "username" | "role" | "disabled" | "createdAt">;

function signingKey() {
  const value = env().SESSION_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return new TextEncoder().encode(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, encoded: string) {
  const [, salt, hex] = encoded.split(":");
  if (!salt || !hex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const toPublicUser = (user: UserRecord): PublicUser => ({ username: user.username, role: user.role, disabled: user.disabled, createdAt: user.createdAt });

/** Returns all users, creating the bootstrap admin when the user store is empty. */
export async function listUsers() {
  const users = await readJson<UserRecord[]>(files.users, []);
  const { BOOTSTRAP_ADMIN_USERNAME: username, BOOTSTRAP_ADMIN_PASSWORD: password } = env();
  if (users.length || !username || !password) return users;
  return updateJson<UserRecord[]>(files.users, [], (current) => current.length ? current : [{ username, passwordHash: hashPassword(password), role: "admin", createdAt: new Date().toISOString() }]);
}

export async function authenticate(username: string, password: string) {
  const user = (await listUsers()).find((item) => item.username === username && !item.disabled);
  return user && passwordMatches(password, user.passwordHash) ? user : null;
}

export async function upsertUser(input: { username: string; password?: string; role: Role; disabled?: boolean }) {
  await listUsers();
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
  await updateJson<UserRecord[]>(files.users, [], (users) => {
    const activeAdmins = users.filter((user) => user.role === "admin" && !user.disabled);
    if (activeAdmins.length <= 1 && users.find((user) => user.username === username)?.role === "admin") throw new Error("必须保留至少一个管理员");
    return users.filter((user) => user.username !== username);
  });
  await updateJson<SessionRecord[]>(files.sessions, [], (sessions) => sessions.filter((session) => session.username !== username));
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

