import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-text">
        Olá, {session?.user?.name?.split(" ")[0] ?? "tudo bem"}.
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        O dashboard executivo (faturamento, pipeline, estoque, prazos) entra no Sprint 10,
        depois que os demais módulos existirem para alimentá-lo com dados reais — ver Etapa 5,
        seção 02. Por enquanto, esta é a fundação: login, permissões e auditoria funcionando.
      </p>
    </div>
  );
}
