import { notFound } from "next/navigation";
import { MODULES, getModule } from "@/lib/modules";
import { ModuleScreen } from "@/components/ModuleScreen";

export function generateStaticParams() {
  return MODULES.map((m) => ({ id: m.id }));
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getModule(id)) notFound();
  return <ModuleScreen id={id} />;
}
