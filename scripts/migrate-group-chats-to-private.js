#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Option A migration:
 * - visibility: "group" -> "private"
 * - ownerUid: existing ownerUid, otherwise createdBy
 *
 * Usage:
 * - Dry run (default): node scripts/migrate-group-chats-to-private.js
 * - Apply changes:     node scripts/migrate-group-chats-to-private.js --apply
 * - Single org:        node scripts/migrate-group-chats-to-private.js --apply --org=<ORG_ID>
 *
 * Requirements:
 * - Firebase Admin credentials available in environment
 *   (for example GOOGLE_APPLICATION_CREDENTIALS).
 */

const admin = require("firebase-admin");

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const orgArg = argv.find((arg) => arg.startsWith("--org="));
  const orgId = orgArg ? orgArg.slice("--org=".length).trim() : null;
  return { apply, orgId: orgId || null };
}

function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function commitBatches(updates, apply) {
  if (!apply || updates.length === 0) return 0;
  let committed = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const batch = admin.firestore().batch();
    for (const update of chunk) {
      batch.set(update.ref, update.payload, { merge: true });
    }
    await batch.commit();
    committed += chunk.length;
  }
  return committed;
}

async function run() {
  const { apply, orgId } = parseArgs(process.argv.slice(2));

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const db = admin.firestore();
  const organizationsRef = db.collection("organizations");
  const orgDocs = [];

  if (orgId) {
    const snap = await organizationsRef.doc(orgId).get();
    if (!snap.exists) {
      throw new Error(`Organization not found: ${orgId}`);
    }
    orgDocs.push(snap);
  } else {
    const snap = await organizationsRef.get();
    orgDocs.push(...snap.docs);
  }

  let orgCount = 0;
  let scannedChats = 0;
  let convertibleChats = 0;
  let skippedChats = 0;
  let committedChats = 0;
  const updates = [];

  for (const orgSnap of orgDocs) {
    orgCount += 1;
    const chatsSnap = await orgSnap.ref.collection("chats").where("visibility", "==", "group").get();
    if (chatsSnap.empty) continue;

    for (const chatSnap of chatsSnap.docs) {
      scannedChats += 1;
      const data = chatSnap.data() || {};
      const ownerUid = asNonEmptyString(data.ownerUid) || asNonEmptyString(data.createdBy);
      const ownerName = asNonEmptyString(data.ownerName);

      if (!ownerUid) {
        skippedChats += 1;
        console.log(
          `[SKIP] org=${orgSnap.id} chat=${chatSnap.id} reason=missing ownerUid and createdBy`,
        );
        continue;
      }

      convertibleChats += 1;
      updates.push({
        ref: chatSnap.ref,
        payload: {
          visibility: "private",
          ownerUid,
          ownerName: ownerName || null,
          updatedAt: new Date(),
          updatedBy: ownerUid,
        },
      });
    }
  }

  committedChats = await commitBatches(updates, apply);

  console.log("----- Migration Summary -----");
  console.log(`Mode: ${apply ? "APPLY" : "DRY_RUN"}`);
  console.log(`Organizations scanned: ${orgCount}`);
  console.log(`Group chats scanned: ${scannedChats}`);
  console.log(`Convertible chats: ${convertibleChats}`);
  console.log(`Skipped chats: ${skippedChats}`);
  console.log(`Chats updated: ${committedChats}`);
}

run().catch((err) => {
  console.error("Migration failed:", err?.message || err);
  process.exitCode = 1;
});
