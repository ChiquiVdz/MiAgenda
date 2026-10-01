import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ShoppingView } from "./shopping-view";

export default async function ShoppingPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return <ShoppingView />;
}
