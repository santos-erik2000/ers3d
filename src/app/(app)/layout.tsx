import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header userName={session.user.name ?? session.user.email ?? "Usuário"} />
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
