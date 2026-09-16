import { Room } from "@/components/room";
export default async function RoomPage({ params, searchParams }: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ count?: string; role?: string; retain?: string }>;
}) {
  const { roomId } = await params;
  const query = await searchParams;
  const count = query.count === "9" ? 9 : query.count === "25" ? 25 : 16;
  return <Room roomId={roomId} count={count} persona={query.role === "guest" ? "guest" : "host"} retention={query.retain === "1" ? "retain" : "delete_when_empty"} />;
}
