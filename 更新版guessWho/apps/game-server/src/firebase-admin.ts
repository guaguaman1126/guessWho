import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Card } from "@guesswho/shared/game-types";
import type { PlayerRecord, RoomAggregate, RoomRecord } from "./game-rules.js";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-guesswho";
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`;
const app = getApps()[0] ?? initializeApp({ projectId, storageBucket });

export const auth = getAuth(app);
export const db = getFirestore(app);
export const bucket = getStorage(app).bucket(storageBucket);

type Loaded = {
  aggregate: RoomAggregate;
  playerIds: string[];
  targetIds: string[];
  cardIds: string[];
  hadPassword: boolean;
};

export async function createAggregate(state: RoomAggregate): Promise<void> {
  const roomRef = db.doc(`rooms/${state.roomId}`);
  await db.runTransaction(async transaction => {
    if ((await transaction.get(roomRef)).exists) throw new Error("ROOM_ID_COLLISION");
    save(transaction, roomRef, state, { playerIds: [], targetIds: [], cardIds: [], hadPassword: false });
  });
}

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

export async function updateAggregate<T>(roomId: string, mutate: (state: RoomAggregate) => T): Promise<{ value: T; state: RoomAggregate }> {
  const roomRef = db.doc(`rooms/${roomId}`);
  return db.runTransaction(async transaction => {
    const loaded = await load(transaction, roomRef, roomId);
    const value = mutate(loaded.aggregate);
    if ((value as { deleteRoom?: boolean })?.deleteRoom) erase(transaction, roomRef, loaded);
    else save(transaction, roomRef, loaded.aggregate, loaded);
    return { value, state: loaded.aggregate };
  });
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

async function load(transaction: Transaction, roomRef: DocumentReference, roomId: string): Promise<Loaded> {
  const room = await transaction.get(roomRef);
  if (!room.exists) throw new Error("找不到房間");
  const [players, targets, cards, access] = await Promise.all([
    transaction.get(roomRef.collection("players")), transaction.get(roomRef.collection("targets")),
    transaction.get(roomRef.collection("cards")), transaction.get(roomRef.collection("secrets").doc("access")),
  ]);
  return {
    aggregate: fromSnapshots(roomId, room.data() as RoomRecord,
      players.docs.map(doc => ({ uid: doc.id, ...doc.data() }) as PlayerRecord),
      targets.docs.map(doc => [doc.id, doc.data().targetCardId as number]),
      cards.docs.map(doc => ({ id: Number(doc.id), ...doc.data() }) as Card),
      access.data()?.password ?? null),
    playerIds: players.docs.map(doc => doc.id), targetIds: targets.docs.map(doc => doc.id),
    cardIds: cards.docs.map(doc => doc.id), hadPassword: access.exists,
  };
}

function fromSnapshots(roomId: string, room: RoomRecord, players: PlayerRecord[], targets: [string, number][], cards: Card[], password: string | null): RoomAggregate {
  return { roomId, room, players, targets: Object.fromEntries(targets), cards: cards.sort((a, b) => a.id - b.id), password };
}

function save(transaction: Transaction, roomRef: DocumentReference, state: RoomAggregate, previous: Pick<Loaded, "playerIds" | "targetIds" | "cardIds" | "hadPassword">): void {
  transaction.set(roomRef, state.room);
  syncDocs(transaction, roomRef, "players", previous.playerIds, state.players.map(player => [player.uid, stripUid(player)]));
  syncDocs(transaction, roomRef, "targets", previous.targetIds, Object.entries(state.targets).map(([uid, targetCardId]) => [uid, { targetCardId }]));
  syncDocs(transaction, roomRef, "cards", previous.cardIds, state.cards.map(card => [String(card.id), { name: card.name, imagePath: card.imagePath }]));
  const access = roomRef.collection("secrets").doc("access");
  if (state.password === null) { if (previous.hadPassword) transaction.delete(access); }
  else transaction.set(access, { password: state.password });
}

function syncDocs(transaction: Transaction, roomRef: DocumentReference, collection: string, oldIds: string[], entries: [string, object][]): void {
  const nextIds = new Set(entries.map(([id]) => id));
  for (const oldId of oldIds) if (!nextIds.has(oldId)) transaction.delete(roomRef.collection(collection).doc(oldId));
  for (const [id, data] of entries) transaction.set(roomRef.collection(collection).doc(id), data);
}

function erase(transaction: Transaction, roomRef: DocumentReference, loaded: Loaded): void {
  for (const id of loaded.playerIds) transaction.delete(roomRef.collection("players").doc(id));
  for (const id of loaded.targetIds) transaction.delete(roomRef.collection("targets").doc(id));
  for (const id of loaded.cardIds) transaction.delete(roomRef.collection("cards").doc(id));
  if (loaded.hadPassword) transaction.delete(roomRef.collection("secrets").doc("access"));
  transaction.delete(roomRef);
}

function stripUid(player: PlayerRecord): Omit<PlayerRecord, "uid"> {
  const { uid: _uid, ...data } = player;
  return data;
}
