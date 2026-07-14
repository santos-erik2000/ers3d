"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  enabled: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", enabled: true },
  { href: "/crm", label: "CRM (Kanban)", enabled: true },
  { href: "/clientes", label: "Clientes", enabled: true },
  { href: "/calculadora", label: "Calculadora 3D", enabled: true },
  { href: "/estoque", label: "Estoque de filamento", enabled: true },
  { href: "/estoque-pecas", label: "Estoque de peças", enabled: true },
  { href: "/financeiro", label: "Financeiro", enabled: true },
  { href: "/relatorios", label: "Relatórios", enabled: false },
  { href: "/usuarios", label: "Usuários & Permissões", enabled: true },
  { href: "/configuracoes", label: "Configurações", enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-none flex-col bg-gradient-to-b from-accent-strong to-accent px-5 py-8 text-white">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/70">
        ERS 3D
      </p>
      <p className="mt-1 text-sm text-white/85">Gestão de Soluções e Fabricações</p>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          // Comparação exata ou por segmento de rota (nunca prefixo solto) —
          // evita que "/estoque" fique marcado como ativo quando a rota atual
          // é "/estoque-pecas" (Sprint 8, mesmo problema apareceria com
          // qualquer outro par de rotas prefixadas uma pela outra).
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          if (!item.enabled) {
            return (
              <span
                key={item.href}
                title="Ainda não implementado"
                className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-white/40"
              >
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition ${
                isActive ? "bg-white/15 font-medium text-white" : "text-white/85 hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
