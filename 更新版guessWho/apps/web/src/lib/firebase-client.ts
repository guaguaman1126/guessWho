"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, type FirebaseStorage } from "firebase/storage";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents } from "@guesswho/shared/socket-events";

let initialized = false;

export function firebaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
}

export function getFirebase(): { auth: Auth; storage: FirebaseStorage } {
  if (!firebaseConfigured()) throw new Error("尚未設定 Firebase 前端環境變數");
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  const auth = getAuth(app);
  const storage = getStorage(app);
  if (!initialized && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  initialized = true;
  return { auth, storage };
}

export async function authenticatedSocket(): Promise<Socket<ServerEvents, ClientEvents>> {
  const { auth } = getFirebase();
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  const token = await user.getIdToken();
  return io(process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "http://localhost:4000", { auth: { token } });
}

export async function imageUrl(path: string): Promise<string> {
  if (!path || path.startsWith("/") || path.startsWith("data:") || path.startsWith("http")) return path;
  return getDownloadURL(ref(getFirebase().storage, path));
}

export function roomPasswordKey(roomId: string): string {
  return `guesswho:password:${roomId.toUpperCase()}`;
}
