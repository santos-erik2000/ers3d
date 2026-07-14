import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { listUsersWithRoles } from "@/modules/auth/services/users";
import { getDeadlineStatus, formatCurrency, PRIORITY_LABEL, STAGE_LABEL } from "@/modules/crm/format";
import { getOpportunityById } from "@/modules/crm/services/opportunities";
import { getDeliveryByOpportunity } from "@/modules/deliveries/services/deliveries";
import { getAccountsReceivableByOpportunity } from "@/modules/finance/services/receivables";
import { listInventoryItemsByOpportunity } from "@/modules/inventory/services/inventory";
import { listJobs } from "@/modules/jobs/services/jobs";
import { getProductionOrderByOpportunity, listPrinters } from "@/modules/production/services/production";
import { getQualityHistoryForOpportunity } from "@/modules/quality/services/quality";
import { getQuoteWithVersions } from "@/modules/quotes/services/quotes";
import { JobOption, QuotePanel, QuoteVersionView } from "./quote-panel";
import { ProductionOrderView, ProductionPanel, SelectOption } from "./production-panel";
import { QualityCheckView, QualityPanel } from "./quality-panel";
import { InventoryItemView, InventoryPanel } from "./inventory-panel";
import { DeliveryView, DeliveryPanel } from "./delivery-panel";
import { FinanceView, FinancePanel } from "./finance-panel";

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Sprint 5: a página de detalhe da oportunidade (que inclui o orçamento)
  // exige `crm.manage` para visualizar, mesma permissão do quadro Kanban —
  // as ações de escrita do orçamento em si exigem `quotes.manage`
  // (checado dentro de cada Server Action em src/modules/quotes/actions.ts).
  await requirePermission(PERMISSIONS.CRM_MANAGE);
  const { id } = await params;

  const opportunity = await getOpportunityById(id);
  if (!opportunity) notFound();

  const [quote, jobs, productionOrder, printers, users, qualityHistory, inventoryItems, delivery, accountsReceivable] =
    await Promise.all([
      getQuoteWithVersions(id),
      listJobs(),
      getProductionOrderByOpportunity(id),
      listPrinters(),
      listUsersWithRoles(),
      getQualityHistoryForOpportunity(id),
      listInventoryItemsByOpportunity(id),
      getDeliveryByOpportunity(id),
      getAccountsReceivableByOpportunity(id),
    ]);

  const versions: QuoteVersionView[] = (quote?.versions ?? []).map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    isManual: v.isManual,
    manualJustification: v.manualJustification,
    originalValue: v.originalValue.toString(),
    discount: v.discount.toString(),
    finalValue: v.finalValue.toString(),
    paymentTerms: v.paymentTerms,
    deliveryDeadline: v.deliveryDeadline ? v.deliveryDeadline.toISOString() : null,
    quantity: v.quantity,
    notes: v.notes,
    sentAt: v.sentAt ? v.sentAt.toISOString() : null,
    acceptedAt: v.acceptedAt ? v.acceptedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    jobId: v.jobId,
    jobProjectName: v.job?.project?.name ?? null,
  }));

  const jobOptions: JobOption[] = jobs.map((j) => ({
    id: j.id,
    label: j.project.name,
    finalPrice: j.finalPrice.toString(),
  }));

  const productionOrderView: ProductionOrderView | null = productionOrder
    ? {
        id: productionOrder.id,
        printStatus: productionOrder.printStatus,
        plannedStartAt: productionOrder.plannedStartAt ? productionOrder.plannedStartAt.toISOString() : null,
        plannedEndAt: productionOrder.plannedEndAt ? productionOrder.plannedEndAt.toISOString() : null,
        actualHours: productionOrder.actualHours ? productionOrder.actualHours.toString() : null,
        technicalNotes: productionOrder.technicalNotes,
        completedAt: productionOrder.completedAt ? productionOrder.completedAt.toISOString() : null,
        printerId: productionOrder.printerId,
        printerName: productionOrder.printer?.name ?? null,
        responsibleId: productionOrder.responsibleId,
        responsibleName: productionOrder.responsible?.name ?? null,
        jobId: productionOrder.jobId,
        filaments: (productionOrder.job?.jobFilaments ?? []).map((jf) => ({
          filamentId: jf.filamentId,
          filamentName: jf.filament.name,
          gramsUsed: jf.gramsUsed.toString(),
          gramsActual: jf.gramsActual ? jf.gramsActual.toString() : null,
        })),
      }
    : null;

  const printerOptions: SelectOption[] = printers.map((p) => ({ id: p.id, name: p.name }));
  const responsibleOptions: SelectOption[] = users.map((u) => ({ id: u.id, name: u.name }));

  const deadline = getDeadlineStatus(opportunity.deadlineAt, opportunity.stage);

  // Sprint 7 — mesma pré-condição checada de verdade em
  // src/modules/quality/services/quality.ts (submitQualityCheck): só faz
  // sentido oferecer o formulário do checklist quando a oportunidade está em
  // Teste de Qualidade e a ordem de produção mais recente já foi concluída.
  const canSubmitQualityCheck =
    opportunity.stage === "QUALIDADE" && productionOrder?.printStatus === "CONCLUIDA";

  const qualityHistoryView: QualityCheckView[] = qualityHistory.map((check) => ({
    id: check.id,
    result: check.result,
    rejectionReason: check.rejectionReason,
    checkedAt: check.checkedAt.toISOString(),
    checkedByName: check.checkedBy?.name ?? null,
    items: check.items.map((item) => ({
      id: item.id,
      label: item.label,
      passed: item.passed,
      notes: item.notes,
      evidencePhotoUrl: item.evidencePhotoUrl,
    })),
  }));

  const inventoryItemsView: InventoryItemView[] = inventoryItems.map((item) => ({
    id: item.id,
    quantityProduced: item.quantityProduced,
    quantityAvailable: item.quantityAvailable,
    quantityReserved: item.quantityReserved,
    quantitySold: item.quantitySold,
    quantityDiscarded: item.quantityDiscarded,
    unitCost: item.unitCost ? item.unitCost.toString() : null,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  }));

  const deliveryView: DeliveryView | null = delivery
    ? {
        id: delivery.id,
        method: delivery.method,
        status: delivery.status,
        address: delivery.address,
        recipientName: delivery.recipientName,
        trackingCode: delivery.trackingCode,
        expectedAt: delivery.expectedAt ? delivery.expectedAt.toISOString() : null,
        shippedAt: delivery.shippedAt ? delivery.shippedAt.toISOString() : null,
        deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
        proofUrl: delivery.proofUrl,
        notes: delivery.notes,
        checklistItems: delivery.checklistItems.map((item) => ({
          id: item.id,
          label: item.label,
          checked: item.checked,
          notes: item.notes,
        })),
      }
    : null;

  // Sprint 8: o registro de entrega só faz sentido quando a oportunidade já
  // está na etapa Entrega (mesma pré-condição checada de verdade em
  // src/modules/deliveries/services/deliveries.ts, `createDelivery`).
  const canCreateDelivery = opportunity.stage === "ENTREGA";

  const accountsReceivableView: FinanceView | null = accountsReceivable
    ? {
        id: accountsReceivable.id,
        grossValue: accountsReceivable.grossValue.toString(),
        discount: accountsReceivable.discount.toString(),
        netValue: accountsReceivable.netValue.toString(),
        status: accountsReceivable.status,
        dueDate: accountsReceivable.dueDate ? accountsReceivable.dueDate.toISOString() : null,
        installments: accountsReceivable.installments.map((installment) => ({
          id: installment.id,
          installmentNumber: installment.installmentNumber,
          amount: installment.amount.toString(),
          amountPaid: installment.amountPaid.toString(),
          dueDate: installment.dueDate ? installment.dueDate.toISOString() : null,
          status: installment.status,
          paymentMethod: installment.paymentMethod,
          transactions: installment.transactions.map((t) => ({
            id: t.id,
            type: t.type,
            amount: t.amount.toString(),
            transactionDate: t.transactionDate.toISOString(),
            registeredByName: t.registeredBy?.name ?? null,
            hasReversal: t.reversal !== null,
          })),
        })),
      }
    : null;

  return (
    <div className="max-w-4xl">
      <Link href="/crm" className="text-sm text-accent hover:underline">
        ← CRM
      </Link>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-faint">Oportunidade</p>
      <h1 className="mt-1 text-2xl font-semibold text-text">{opportunity.title}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {opportunity.customer.name} · {STAGE_LABEL[opportunity.stage]} · Prioridade{" "}
        {PRIORITY_LABEL[opportunity.priority]}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Dados da oportunidade</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Row label="Valor negociado" value={formatCurrency(opportunity.value)} />
            <Row label="Responsável" value={opportunity.owner?.name ?? "Sem responsável"} />
            <Row label="Prazo" value={deadline.label} />
            <Row label="Ciclo atual" value={opportunity.cycle ? formatMonth(opportunity.cycle.referenceMonth) : "—"} />
            {opportunity.carriedFromCycle && (
              <Row
                label="Pendência carregada de"
                value={formatMonth(opportunity.carriedFromCycle.referenceMonth)}
              />
            )}
            <Row label="Tags" value={opportunity.tags.length ? opportunity.tags.join(", ") : "—"} />
          </dl>
        </section>

        <QuotePanel
          opportunityId={id}
          quoteStatus={quote?.status ?? null}
          lostReason={quote?.lostReason ?? null}
          versions={versions}
          jobs={jobOptions}
        />

        <ProductionPanel
          opportunityId={id}
          order={productionOrderView}
          printers={printerOptions}
          responsibles={responsibleOptions}
        />

        <QualityPanel
          opportunityId={id}
          canSubmit={canSubmitQualityCheck}
          productionOrderId={productionOrder?.id ?? null}
          history={qualityHistoryView}
        />

        <InventoryPanel opportunityId={id} items={inventoryItemsView} />

        <DeliveryPanel opportunityId={id} canCreate={canCreateDelivery} delivery={deliveryView} />

        <FinancePanel opportunityId={id} accountsReceivable={accountsReceivableView} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}
