"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeCycleAction } from "@/modules/crm/cycle-actions";
import type { CycleClosureDecisionType } from "@/modules/crm/services/cycles";

export type OpenCard = { id: string; title: string; customerName: string };

/**
 * Fechamento de ciclo mensal (CRM-5). Nunca fecha "no escuro": exige que o
 * usuário decida, card a card, entre "transportar" (segue no novo ciclo, sem
 * marcação) e "manter como pendência carregada" (segue no novo ciclo,
 * marcada com `carriedFromCycleId` apontando para este ciclo) antes de
 * habilitar o botão de confirmação — o backend revalida a mesma regra (ver
 * src/modules/crm/services/cycles.ts, closeCycle).
 */
export function CloseCycleForm({
  cycleId,
  referenceMonthLabel,
  cards,
}: {
  cycleId: string;
  referenceMonthLabel: string;
  cards: OpenCard[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, CycleClosureDecisionType>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setDecision(id: string, decision: CycleClosureDecisionType) {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  }

  const allDecided = cards.every((card) => decisions[card.id]);

  async function handleSubmit() {
    if (!allDecided) {
      setError("Decida (transportar ou manter como pendência carregada) todos os cards em aberto antes de confirmar.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await closeCycleAction(
      cycleId,
      Object.entries(decisions).map(([opportunityId, decision]) => ({ opportunityId, decision })),
    );
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition hover:border-accent hover:text-accent"
      >
        Fechar ciclo ({referenceMonthLabel})
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border-strong bg-surface-alt p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Fechar ciclo — {referenceMonthLabel}</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted hover:underline">
          Cancelar
        </button>
      </div>

      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">
          Nenhum card em aberto neste ciclo — pode confirmar o fechamento direto.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-text-muted">
            Decida o destino de cada card ainda em aberto antes de confirmar — nenhum card é apagado nem
            transportado silenciosamente.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface p-2 text-sm"
              >
                <div>
                  <p className="font-medium text-text">{card.title}</p>
                  <p className="text-xs text-text-muted">{card.customerName}</p>
                </div>
                <div className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setDecision(card.id, "TRANSPORT")}
                    className={`rounded-sm px-2 py-1 ${
                      decisions[card.id] === "TRANSPORT"
                        ? "bg-accent text-white"
                        : "border border-border text-text-muted"
                    }`}
                  >
                    Transportar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision(card.id, "CARRY_AS_PENDING")}
                    className={`rounded-sm px-2 py-1 ${
                      decisions[card.id] === "CARRY_AS_PENDING"
                        ? "bg-accent text-white"
                        : "border border-border text-text-muted"
                    }`}
                  >
                    Pendência carregada
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || !allDecided}
        className="mt-3 w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Fechando…" : "Confirmar fechamento"}
      </button>
    </div>
  );
}
