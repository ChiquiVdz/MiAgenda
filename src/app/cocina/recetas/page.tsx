import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { RecipesView } from "@/app/cocina/recetas/recipes-view";

export default async function RecipesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <RecipesView />;
}
