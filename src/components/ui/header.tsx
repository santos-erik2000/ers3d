import { logoutAction } from "@/modules/auth/actions";

export function Header({ userName }: { userName: string }) {
  return (
    <header className="flex h-16 flex-none items-center justify-between border-b border-border bg-surface px-6">
      <div className="text-sm text-text-muted">ERS 3D — Gestão de Soluções e Fabricações</div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-text">{userName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition hover:border-border-strong hover:text-text"
          >
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
