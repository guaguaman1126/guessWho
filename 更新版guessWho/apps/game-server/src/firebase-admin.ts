import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Card } from "@guesswho/shared/game-types";
import type { PlayerRecord, RoomAggregate, RoomRecord } from "./game-rules.js";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-guesswho";
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`;
const app = getApps()[0] ?? initializeApp({ projectId, storageBucket });

export const auth = getAuth(app);
export const db = getFirestore(app);
export const bucket = getStorage(app).bucket(storageBucket);

export async function readAggregate(roomId: string): Promise<RoomAggregate | null> {
  const roomRef = db.doc(`rooms/${roomId}`);
  const room = await roomRef.get();
  if (!room.exists) return null;
  const [players, targets, cards, access] = await Promise.all([
    roomRef.collection("players").get(), roomRef.collection("targets").get(),
    roomRef.collection("cards").get(), roomRef.collection("secrets").doc("access").get(),
  ]);
  return fromSnapshots(roomId, room.data() as RoomRecord,
    players.docs.map(doc => ({ uid: doc.id, ...doc.data() }) as PlayerRecord),
    targets.docs.map(doc => [doc.id, doc.data().targetCardId as number]),
    cards.docs.map(doc => ({ id: Number(doc.id), ...doc.data() }) as Card),
    access.data()?.password ?? null);
}
export async function listRooms(): Promise<RoomAggregate[]> {
  // ponytail: 每日一次、第一版低房量直接掃描；房量變大時再加複合索引與分頁。
  const snapshot = await db.collection("rooms").get();
  const rooms = await Promise.all(snapshot.docs.map(doc => readAggregate(doc.id)));
  return rooms.filter((room): room is RoomAggregate => room !== null);
}

export async function deleteImages(paths: string[] = []): Promise<void> {
  await Promise.all(paths.filter(Boolean).map(path => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
}

export async function deleteRoomImages(roomId: string): Promise<void> {
  await bucket.deleteFiles({ prefix: `rooms/${roomId}/` }).catch(() => undefined);
}

function fromSnapshots(roomId: string, room: RoomRecord, players: PlayerRecord[], targets: [string, number][], cards: Card[], password: string | null): RoomAggregate {
  room.deckVersion ??= 0;
  delete (room as RoomRecord & { lastResult?: unknown }).lastResult;
  return { roomId, room, players, targets: Object.fromEntries(targets), cards: cards.sort((a, b) => a.id - b.id), password };
}
