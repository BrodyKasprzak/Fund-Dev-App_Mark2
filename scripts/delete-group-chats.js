#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Delete all chats where visibility == "group", including their messages subcollection.
 *
 * Usage:
 * - Dry run (default): node scripts/delete-group-chats.js
 * - Apply:             node scripts/delete-group-chats.js --apply
 * - Single org:        node scripts/delete-group-chats.js --apply --org=<ORG_ID>
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const orgArg = argv.find((arg) => arg.startsWith("--org="));
  const orgId = orgArg ? orgArg.slice("--org=".length).trim() : null;
  return { apply, orgId: orgId || null };
}

function parseDotenvLine(line) {
  const idx = line.indexOf("=");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  if (!key || key.startsWith("#")) return null;
  let value = line.slice(idx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(rawLine);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function initAdmin() {
  if (admin.apps.length > 0) return;
  loadEnvLocal();

  const projectId = mustEnv("FIREBASE_PROJECT_ID");
  const clientEmail = mustEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = mustEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

async function deleteMessagesSubcollection(chatRef) {
  let deleted = 0;
  while (true) {
    const snap = await chatRef
      .collection("messages")
      .orderBy("__name__")
      .limit(400)
      .get();
    if (snap.empty) break;

    const batch = admin.firestore().batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function run() {
  const { apply, orgId } = parseArgs(process.argv.slice(2));
  initAdmin();
  const db = admin.firestore();

  const orgDocs = [];
  if (orgId) {
    const orgSnap = await db.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) throw new Error(`Organization not found: ${orgId}`);
    orgDocs.push(orgSnap);
  } else {
    const orgsSnap = await db.collection("organizations").get();
    orgDocs.push(...orgsSnap.docs);
  }

  let scannedOrgs = 0;
  let groupChatsFound = 0;
  let deletedChats = 0;
  let deletedMessages = 0;

  for (const orgSnap of orgDocs) {
    scannedOrgs += 1;
    const chatsSnap = await orgSnap.ref
      .collection("chats")
      .where("visibility", "==", "group")
      .get();

    if (chatsSnap.empty) continue;
    groupChatsFound += chatsSnap.size;

    for (const chatSnap of chatsSnap.docs) {
      if (!apply) continue;
      const removedMessages = await deleteMessagesSubcollection(chatSnap.ref);
      await chatSnap.ref.delete();
      deletedChats += 1;
      deletedMessages += removedMessages;
      console.log(
        `[DELETED] org=${orgSnap.id} chat=${chatSnap.id} messages=${removedMessages}`,
      );
    }
  }

  console.log("----- Group Chat Deletion Summary -----");
  console.log(`Mode: ${apply ? "APPLY" : "DRY_RUN"}`);
  console.log(`Organizations scanned: ${scannedOrgs}`);
  console.log(`Group chats found: ${groupChatsFound}`);
  console.log(`Chats deleted: ${deletedChats}`);
  console.log(`Messages deleted: ${deletedMessages}`);
}

run().catch((err) => {
  console.error("Deletion failed:", err?.message || err);
  process.exitCode = 1;
});

