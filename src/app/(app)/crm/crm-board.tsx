"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { moveOpportunityStageAction } from "@/modules/crm/actions";
import {
  NEXT_STAGE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STAGE_COLUMNS,
  STAGE_LABEL,
  daysSince,
  formatCurrency,
  getDeadlineStatus,
  type DeadlineTone,
} from "@/modules/crm/format";
import type { OpportunityPriority, OpportunityStage } from "@prisma/client";

export type BoardOpportunity = {
  id: string;
  title: string;
  value: string;
  stage: OpportunityStage;
  priority: OpportunityPriority;
  tags: string[];
  deadlineAt: string | null;
  customer: { id: string; name: string };
  owner: { id: string; name: string } | null;
  lastMovedAt: string;
};

type Person = { id: string; name: string };

const TONE_CLASS: Record<DeadlineTone, string> = {
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  neutral: "bg-neutral-soft text-neutral",
};

// planejamento/01-visao-arquitetura.html §09 — a única transição para trás
// permitida no MVP é a reprovação de qualidade, e ela exige motivo obrigatório.
function needsNote(from: OpportunityStage, to: OpportunityStage): boolean {
  return from === "QUALIDADE" && to === "DESENVOLVIMENTO";
}

function promptForRejectionNote(title: string): string | null {
  const note = window.prompt(
    `Motivo obrigatório para reprovar "${title}" e devolver para Desenvolvimento:`,
  );
  return note && note.trim() ? note.trim() : null;
}

function OpportunityCardView({
  opportunity,
  dragging = false,
}: {
  opportunity: BoardOpportunity;
  dragging?: boolean;
}) {
  const deadline = getDeadlineStatus(opportunity.deadlineAt, opportunity.stage);
  const days = daysSince(new Date(opportunity.lastMovedAt));

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm shadow-sm ${
        dragging ? "rotate-1 shadow-lg" : ""
      }`}
    >
      <p className="font-medium text-text">{opportunity.title}</p>
      <p className="text-text-muted">{opportunity.customer.name}</p>

      <p className="font-semibold tabular-nums text-text">{formatCurrency(opportunity.value)}</p>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[PRIORITY_TONE[opportunity.priority]]}`}
        >
          Prioridade {PRIORITY_LABEL[opportunity.priority]}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[deadline.tone]}`}>
          {deadline.label}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-text-faint">
        <span>{opportunity.owner?.name ?? "Sem responsável"}</span>
        <span>{days === 0 ? "Entrou hoje na etapa" : `${days} dia(s) na etapa`}</span>
      </div>

      {opportunity.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {opportunity.tags.map((tag) => (
            <span key={tag} className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-strong">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableCard({
  opportunity,
  onQuickMove,
}: {
  opportunity: BoardOpportunity;
  onQuickMove: (id: string, to: OpportunityStage, note?: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
    data: { stage: opportunity.stage },
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const nextStage = NEXT_STAGE[opportunity.stage];

  function handleQuickMove() {
    if (!nextStage) return;
    if (needsNote(opportunity.stage, nextStage)) {
      const note = promptForRejectionNote(opportunity.title);
      if (!note) return;
      onQuickMove(opportunity.id, nextStage, note);
      return;
    }
    onQuickMove(opportunity.id, nextStage);
  }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-40" : ""}>
      <div {...listeners} {...attributes} className="cursor-grab touch-none active:cursor-grabbing">
        <OpportunityCardView opportunity={opportunity} />
      </div>
      {nextStage && (
        <button
          type="button"
          onClick={handleQuickMove}
          className="mt-1 w-full rounded-sm border border-border px-2 py-1 text-xs text-text-muted transition hover:border-accent hover:text-accent"
        >
          Mover para {STAGE_LABEL[nextStage]} →
        </button>
      )}
    </div>
  );
}

function Column({
  stage,
  count,
  children,
}: {
  stage: OpportunityStage;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-none flex-col gap-2 rounded-lg border border-border bg-surface-alt p-3 ${
        isOver ? "ring-2 ring-accent" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{STAGE_LABEL[stage]}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function CrmBoard({
  initialOpportunities,
  owners,
  customers,
}: {
  initialOpportunities: BoardOpportunity[];
  owners: Person[];
  customers: Person[];
}) {
  const router = useRouter();
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    ownerId: "",
    customerId: "",
    priority: "",
    overdueOnly: false,
  });

  // Ressincroniza com o servidor sempre que a página é revalidada (após um
  // move bem-sucedido, router.refresh() traz o estado canônico do banco).
  useEffect(() => setOpportunities(initialOpportunities), [initialOpportunities]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const filtered = useMemo(() => {
    return opportunities.filter((o) => {
      if (filters.ownerId && o.owner?.id !== filters.ownerId) return false;
      if (filters.customerId && o.customer.id !== filters.customerId) return false;
      if (filters.priority && o.priority !== filters.priority) return false;
      if (filters.overdueOnly && getDeadlineStatus(o.deadlineAt, o.stage).tone !== "danger") return false;
      return true;
    });
  }, [opportunities, filters]);

  async function applyMove(opportunityId: string, toStage: OpportunityStage, note?: string) {
    const previous = opportunities;
    // Otimista: reflete o novo estágio na hora, sem esperar o round-trip do
    // servidor — a validação de verdade acontece no service (moveStage), e se
    // ela rejeitar a gente desfaz e mostra o erro.
    setOpportunities((prev) => prev.map((o) => (o.id === opportunityId ? { ...o, stage: toStage } : o)));
    setError(null);

    const result = await moveOpportunityStageAction(opportunityId, toStage, note);
    if (result.error) {
      setOpportunities(previous);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const opportunity = opportunities.find((o) => o.id === active.id);
    if (!opportunity) return;

    const toStage = over.id as OpportunityStage;
    if (toStage === opportunity.stage) return;

    if (needsNote(opportunity.stage, toStage)) {
      const note = promptForRejectionNote(opportunity.title);
      if (!note) return;
      void applyMove(opportunity.id, toStage, note);
      return;
    }

    void applyMove(opportunity.id, toStage);
  }

  const activeOpportunity = opportunities.find((o) => o.id === activeId) ?? null;
  const hasActiveFilter = Boolean(
    filters.ownerId || filters.customerId || filters.priority || filters.overdueOnly,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-text-muted">
          Responsável
          <select
            className="mt-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text"
            value={filters.ownerId}
            onChange={(e) => setFilters((f) => ({ ...f, ownerId: e.target.value }))}
          >
            <option value="">Todos</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-text-muted">
          Cliente
          <select
            className="mt-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text"
            value={filters.customerId}
            onChange={(e) => setFilters((f) => ({ ...f, customerId: e.target.value }))}
          >
            <option value="">Todos</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-text-muted">
          Prioridade
          <select
            className="mt-1 rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text"
            value={filters.priority}
            onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          >
            <option value="">Todas</option>
            <option value="LOW">Baixa</option>
            <option value="MEDIUM">Média</option>
            <option value="HIGH">Alta</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={filters.overdueOnly}
            onChange={(e) => setFilters((f) => ({ ...f, overdueOnly: e.target.checked }))}
          />
          Só atrasados
        </label>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => setFilters({ ownerId: "", customerId: "", priority: "", overdueOnly: false })}
            className="pb-1.5 text-xs text-accent hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_COLUMNS.map((stage) => {
            const stageOpportunities = filtered.filter((o) => o.stage === stage);
            return (
              <Column key={stage} stage={stage} count={stageOpportunities.length}>
                {stageOpportunities.map((opportunity) => (
                  <DraggableCard key={opportunity.id} opportunity={opportunity} onQuickMove={applyMove} />
                ))}
                {stageOpportunities.length === 0 && (
                  <p className="rounded-sm border border-dashed border-border px-2 py-4 text-center text-xs text-text-faint">
                    Nenhum card
                  </p>
                )}
              </Column>
            );
          })}
        </div>

        <DragOverlay>
          {activeOpportunity ? <OpportunityCardView opportunity={activeOpportunity} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
