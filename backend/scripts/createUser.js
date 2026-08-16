import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/lib/password.js";
import {
  ensureUserIndexes,
  findUserByUsername,
  insertUser,
  updatePasswordHash,
} from "../src/providers/users.js";
import { deleteUserSessions, ensureSessionIndexes } from "../src/providers/sessions.js";
import {
  validateNewPassword,
  validateNewUsername,
  validateRole,
} from "../src/lib/validate.js";
import { USER_ROLE_VALUES } from "../src/config/constants.js";
import { closeMongo } from "../src/providers/mongo.js";

// Creates or resets an account from the shell — the operator path that does not
// depend on POST /api/auth/register being reachable, and the only way to make
// the first account on a deployment where registration is later locked down.
//
//   npm run user:create -- --username demo --password 'correct horse battery' --role tenant
//   npm run user:create -- --username demo --password 'new pass' --force
//
// --force resets an existing user's password AND ends all their sessions,
// because a password reset that leaves old tokens working is not a reset. It
// does not change the role — that is not what "reset my password" means.

const VALUE_FLAGS = ["username", "password", "role"];
const BOOLEAN_FLAGS = ["force"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // Reject anything unrecognised rather than ignoring it. A typo'd `--rol`
    // would otherwise be silently dropped and surface as a confusing "role is
    // required" several steps later.
    if (!arg.startsWith("--")) throw new Error(`unexpected argument "${arg}"`);

    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.includes(key)) {
      args[key] = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(key)) throw new Error(`unknown flag --${key}`);

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage(message) {
  console.error(
    `${message}\n\n` +
      "Usage:\n" +
      "  npm run user:create -- --username <name> --password <password> --role <role> [--force]\n\n" +
      `  --role    ${USER_ROLE_VALUES.join(" | ")} (required for a NEW user)\n` +
      "  --force   reset the password of an existing user and end their sessions\n\n" +
      "Reads MONGODB_URI from .env (via --env-file-if-exists)."
  );
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage(err.message);
  }

  if (!args.username || !args.password) {
    usage("Both --username and --password are required.");
  }
  if (!process.env.MONGODB_URI) {
    usage("MONGODB_URI is not set. Start Mongo (`docker compose up mongo`) and set it in .env.");
  }

  // Same rules the registration endpoint enforces — a script-created account
  // must not be one the API itself would have rejected.
  let username;
  let password;
  let role = null;
  try {
    username = validateNewUsername(args.username);
    password = validateNewPassword(args.password);
    // --role is only meaningful when creating; a password reset keeps the
    // existing role, so it is not required with --force.
    if (args.role !== undefined) role = validateRole(args.role);
  } catch (err) {
    usage(`${err.message}: ${err.details}`);
  }

  await Promise.all([ensureUserIndexes(), ensureSessionIndexes()]);

  const existing = await findUserByUsername(username);

  // Hashing is deliberately AFTER these checks: scrypt costs ~80ms and there is
  // no reason to pay it on a run that is about to exit with a usage error.
  if (existing) {
    if (!args.force) {
      usage(`User "${username}" already exists. Pass --force to reset their password.`);
    }
    if (role && role !== existing.role) {
      // Silently ignoring --role here would print "role: tenant" back at
      // someone who just asked for landlord and believed it worked.
      usage(
        `--force resets a password; it does not change roles. ` +
          `"${username}" is a ${existing.role ?? "user with no role"}. ` +
          `Drop --role, or remove the account and recreate it.`
      );
    }

    await updatePasswordHash(username, await hashPassword(password));
    const ended = await deleteUserSessions(existing._id);
    console.log(
      `Password reset for "${username}" (role: ${existing.role ?? "unset"}). ` +
        `Ended ${ended} active session(s).`
    );
    return;
  }

  if (!role) {
    usage(`--role is required when creating a user (${USER_ROLE_VALUES.join(" | ")}).`);
  }

  await insertUser({
    id: randomUUID(),
    username,
    passwordHash: await hashPassword(password),
    role,
  });
  console.log(`Created ${role} "${username}".`);
}

main()
  .catch((err) => {
    console.error("[createUser] failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
