import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const projectId = mustEnv("FIREBASE_PROJECT_ID");
const clientEmail = mustEnv("FIREBASE_CLIENT_EMAIL");
const privateKey = mustEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
  undefined;

const app =
  getApps().length === 0
    ? initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        ...(storageBucket ? { storageBucket } : {}),
      })
    : getApps()[0];

export const adminDb = getFirestore(app);
export const adminStorage = getStorage(app);

