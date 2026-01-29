import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const projectId = mustEnv("FIREBASE_PROJECT_ID");
const clientEmail = mustEnv("FIREBASE_CLIENT_EMAIL");
const privateKey = mustEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");

const app =
  getApps().length === 0
    ? initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      })
    : getApps()[0];

export const adminDb = getFirestore(app);

