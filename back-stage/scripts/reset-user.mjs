// Resets one account's sign-in: new password, authenticator cleared, sessions revoked.
// Creates the account (as admin unless --role viewer) when it does not exist yet.
// Run through `sudo scripts/launch.sh --reset-user NAME`, which stops back-stage around it.
//
//   node scripts/reset-user.mjs NAME [--role admin|viewer] [--keep-password]
//
// --keep-password leaves the password alone (used when BOOTSTRAP_ADMIN_PASSWORD controls the account).
import { randomBytes, randomInt, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const username = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--role");
const roleArg = args.includes("--role") ? args[args.indexOf("--role") + 1] : undefined;
const keepPassword = args.includes("--keep-password");
if (!username || !/^[a-zA-Z0-9_-]{1,80}$/.test(username) || (roleArg && !["admin", "viewer"].includes(roleArg))) {
  console.error("usage: node scripts/reset-user.mjs NAME [--role admin|viewer] [--keep-password]");
  process.exit(64);
}

const dataDir = process.env.HYPER_CLOCK_DATA_DIR || path.join(process.cwd(), "data");
const usersFile = path.join(dataDir, "runtime-users.json");
const sessionsFile = path.join(dataDir, "runtime-sessions.json");
const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
const write = (file, value) => {
  mkdirSync(dataDir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, file);
};

// Same format as hashPassword() in src/server/auth.ts.
const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
// 4×4 characters without look-alikes (0/O, 1/l/I): easy to type from a terminal.
const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const password = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("")).join("-");

const users = read(usersFile);
let user = users.find((item) => item.username === username);
const created = !user;
if (!user) {
  user = { username, role: roleArg ?? "admin", createdAt: new Date().toISOString() };
  users.push(user);
}
if (roleArg) user.role = roleArg;
delete user.totpSecret;
delete user.totpStep;
delete user.totpPending;
delete user.disabled;
if (!keepPassword) user.passwordHash = hashPassword(password);
write(usersFile, users);

const sessions = read(sessionsFile);
const kept = sessions.filter((session) => session.username !== username);
write(sessionsFile, kept);

console.log(`${created ? "Created" : "Reset"} ${user.role} account "${username}"; authenticator cleared, ${sessions.length - kept.length} session(s) signed out.`);
if (keepPassword) console.log("Password unchanged: it is BOOTSTRAP_ADMIN_PASSWORD from the env file.");
else console.log(`New password: ${password}`);
