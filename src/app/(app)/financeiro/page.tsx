import Link from "next/link";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { getCashflow } from "@/modules/finance/services/cashflow";
import {
  ACCOUNTS_RECEIVABLE_STATUS_LABEL,
  ACCOUNTS_RECEIVABLE_STATUS_TONE,
  formatCurrency,
} from "@/modules/finance/format";
import { getPotentialInventoryProfit, getRealizedProfit } from "@/modules/finance/services/reports";
import { listAccountsReceivable } from "@/modules/finance/services/receivables";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-neutral-soft text-neutral",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/**
 * Visão geral do módulo Financeiro (Sprint 9 — épico E8): contas a receber
 * por status, fluxo de caixa do mês corrente e lucro realizado vs. potencial
 * — deliberadamente separados VISUALMENTE (FIN-4, nunca confundir os dois:
 * um é dinheiro que já entrou no caixa proporcional ao que foi recebido, o
 * outro é uma estimativa do que PODE virar lucro se o estoque disponível for
 * vendido pelo preço de tabela).
 *
 * Rota SOMENTE LEITURA de propósito — exige `finance.read`, que o Contador já
 * tem desde a Fundação (FIN-3: "Como Contador, quero ver fluxo de caixa e
 * contas a receber sem poder editar nada"). Não há nenhum botão de ação
 * aqui — dar baixa/estornar/dividir parcelas fica no painel financeiro
 * dentro de /crm/[id] (mesmo padrão de /estoque-pecas ser só leitura
 * consolidada, com as operações de fato acontecendo na página da
 * oportunidade).
 */
export default async function FinanceiroPage() {
  await requirePermission(PERMISSIONS.FINANCE_READ);

  const now = new Date();
  const period = { start: startOfMonth(now), end: endOfMonth(now) };

  const [receivables, cashflow, realizedProfitPeriod, realizedProfitAllTime, potentialProfit] = await Promise.all([
    listAccountsReceivable(),
    getCashflow(period),
    getRealizedProfit(period),
    getRealizedProfit(),
    getPotentialInventoryProfit(),
  ]);

  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(now);

  const statusOrder: (keyof typeof ACCOUNTS_RECEIVABLE_STATUS_LABEL)[] = [
    "PREVISTO",
    "PENDENTE",
    "PARCIALMENTE_PAGO",
    "VENCIDO",
    "PAGO",
    "CANCELADO",
    "ESTORNADO",
  ];

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Financeiro</h1>
      <p className="mt-1 text-sm text-text-muted">
        Visão consolidada de contas a receber, fluxo de caixa e lucro (<code>finance.read</code>). Para dar baixa,
        estornar ou dividir parcelas, abra a oportunidade correspondente.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Fluxo de caixa — {monthLabel}</h2>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-faint">Receita recebida (caixa real)</dt>
              <dd className="mt-0.5 text-xl font-semibold text-success">{formatCurrency(cashflow.receitaRecebida)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-faint">
                Receita prevista (saldo ainda não recebido)
              </dt>
              <dd className="mt-0.5 text-xl font-semibold text-text-muted">
                {formatCurrency(cashflow.receitaPrevista)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-text-faint">
            Receita prevista nunca é dinheiro em caixa — é o valor negociado ainda pendente de baixa manual.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Lucro realizado × potencial</h2>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-faint">Lucro realizado — {monthLabel}</dt>
              <dd className="mt-0.5 text-xl font-semibold text-success">{formatCurrency(realizedProfitPeriod)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-faint">Lucro realizado — total acumulado</dt>
              <dd className="mt-0.5 text-sm font-medium text-text">{formatCurrency(realizedProfitAllTime)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-faint">Lucro potencial em estoque</dt>
              <dd className="mt-0.5 text-xl font-semibold text-warning">{formatCurrency(potentialProfit)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-text-faint">
            Lucro realizado só conta a margem proporcional ao que já entrou de fato no caixa. Lucro potencial é uma
            estimativa do que pode virar lucro se o estoque disponível hoje for vendido pelo preço de tabela — nunca
            é saldo disponível.
          </p>
        </section>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-text">Contas a receber por status</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Oportunidade</th>
              <th className="px-4 py-3 text-left font-semibold">Valor líquido</th>
              <th className="px-4 py-3 text-left font-semibold">Recebido</th>
              <th className="px-4 py-3 text-left font-semibold">Saldo</th>
              <th className="px-4 py-3 text-left font-semibold">Vencimento</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {receivables.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Nenhuma conta a receber ainda — nasce automaticamente quando uma versão de orçamento é aprovada.
                </td>
              </tr>
            )}
            {receivables.map((ar) => {
              const paid = ar.installments.reduce((sum, i) => sum + Number(i.amountPaid), 0);
              const total = Number(ar.netValue);
              const balance = total - paid;
              return (
                <tr key={ar.id} className="border-t border-border bg-surface">
                  <td className="px-4 py-3 font-medium text-text">
                    <Link href={`/crm/${ar.opportunityId}`} className="text-accent hover:underline">
                      {ar.opportunity.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(ar.netValue)}</td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(paid)}</td>
                  <td className="px-4 py-3">
                    <span className={balance > 0 ? "font-semibold text-warning" : "text-text-muted"}>
                      {formatCurrency(balance)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {ar.dueDate ? new Date(ar.dueDate).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[ACCOUNTS_RECEIVABLE_STATUS_TONE[ar.status]]}`}
                    >
                      {ACCOUNTS_RECEIVABLE_STATUS_LABEL[ar.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-faint">
        {statusOrder.map((s) => (
          <span key={s} className={`rounded-full px-2.5 py-0.5 font-medium ${TONE_CLASS[ACCOUNTS_RECEIVABLE_STATUS_TONE[s]]}`}>
            {ACCOUNTS_RECEIVABLE_STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
