import { PlannerView } from "./planner-view";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function PlanificarPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return <PlannerView />;
}
