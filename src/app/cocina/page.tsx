import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { PantryView } from "@/app/cocina/pantry-view";

export default async function CocinaPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <PantryView />;
}
