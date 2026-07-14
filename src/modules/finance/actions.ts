"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  recordPayment,
  reverseTransaction,
  splitInstallments,
} from "@/modules/finance/services/receivables";
import type { PaymentMethod } from "@prisma/client";

export type FinanceFormState = { error?: string } | undefined;

const VALID_PAYMENT_METHODS: PaymentMethod[] = ["PIX", "MAQUININHA"];

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  return value ? new Date(value) : null;
}

/**
 * Registra a baixa manual de um pagamento (FIN-2) — exige `finance.manage`.
 * Um usuário só com `finance.read` (o caso do Contador) recebe 403 aqui,
 * antes mesmo de o service ser chamado (caso crítico FIN-3, "Contador tenta
 * editar módulo financeiro" — testado explicitamente em
 * src/modules/finance/__tests__/actions.test.ts).
 */
export async function recordPaymentAction(
  _prevState: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const { userId } = await requirePermission(PERMISSIONS.FINANCE_MANAGE);

  const installmentId = String(formData.get("installmentId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!installmentId) return { error: "Parcela não informada." };

  const amount = String(formData.get("amount") ?? "").trim();
  if (!amount) return { error: "Informe o valor do pagamento." };

  const paymentMethodRaw = String(formData.get("paymentMethod") ?? "");
  if (!VALID_PAYMENT_METHODS.includes(paymentMethodRaw as PaymentMethod)) {
    return { error: "Selecione uma forma de pagamento válida (Pix ou maquininha)." };
  }

  try {
    await recordPayment(
      {
        installmentId,
        amount,
        paymentMethod: paymentMethodRaw as PaymentMethod,
        paidAt: parseDate(formData.get("paidAt")),
      },
      userId,
    );
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/financeiro");
  return undefined;
}

/**
 * Estorna uma transação (motivo obrigatório) — exige `finance.manage`. Nunca
 * apaga a transação original (ver src/modules/finance/services/receivables.ts,
 * `reverseTransaction`).
 */
export async function reverseTransactionAction(
  transactionId: string,
  reason: string,
  opportunityId: string,
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.FINANCE_MANAGE);

  try {
    await reverseTransaction(transactionId, reason, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/financeiro");
  return {};
}

/**
 * Redivide o valor total da conta a receber em N parcelas — exige
 * `finance.manage`. Só permitido antes de qualquer pagamento (checado no
 * service).
 */
export async function splitInstallmentsAction(
  _prevState: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const { userId } = await requirePermission(PERMISSIONS.FINANCE_MANAGE);

  const accountsReceivableId = String(formData.get("accountsReceivableId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!accountsReceivableId) return { error: "Conta a receber não informada." };

  const count = Number.parseInt(String(formData.get("count") ?? "").trim(), 10);
  if (!Number.isInteger(count) || count < 1) {
    return { error: "Informe um número de parcelas válido." };
  }

  try {
    await splitInstallments(accountsReceivableId, count, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/financeiro");
  return undefined;
}
