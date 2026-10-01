import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AgendaView } from "@/app/agenda-view";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <AgendaView />;
}
