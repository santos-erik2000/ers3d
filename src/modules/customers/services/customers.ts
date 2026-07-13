import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import type { Customer, CustomerStatus, CustomerType, Prisma } from "@prisma/client";

export class BusinessRuleError extends Error {}

export type DuplicateField = "email" | "phone" | "document";

export type DuplicateMatch = {
  id: string;
  name: string;
  matchedFields: DuplicateField[];
};

export type CustomerInput = {
  name: string;
  type: CustomerType;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  origin?: string | null;
  segment?: string | null;
  notes?: string | null;
  tags?: string[];
  status?: CustomerStatus;
  ownerId?: string | null;
  // "Empresa" é uma tag leve (planejamento/01-visao-arquitetura.html, decisão
  // "Campo empresa do cliente") — o usuário digita o nome e o serviço resolve
  // (encontra ou cria) o registro em `companies`, sem tela de gestão própria.
  companyName?: string | null;
  lastContactAt?: Date | null;
  nextContactAt?: Date | null;
};

export type CreateCustomerResult =
  | { status: "duplicate"; duplicates: DuplicateMatch[] }
  | { status: "created"; customer: Customer };

// --- normalização -----------------------------------------------------------

function onlyDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// --- validação de CPF/CNPJ (Sprint 2 do backlog: "CRUD com validação de CPF/CNPJ") ---

function digitAt(digits: string, index: number): number {
  return parseInt(digits.charAt(index), 10);
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const calcCheckDigit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += digitAt(digits, i) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calcCheckDigit(9) === digitAt(digits, 9) && calcCheckDigit(10) === digitAt(digits, 10);
}

export function isValidCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  const calcCheckDigit = (base: string): number => {
    const weights =
      base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < base.length; index++) {
      sum += digitAt(base, index) * (weights[index] ?? 0);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = calcCheckDigit(digits.slice(0, 12));
  if (d1 !== digitAt(digits, 12)) return false;
  const d2 = calcCheckDigit(digits.slice(0, 13));
  return d2 === digitAt(digits, 13);
}

function assertValidDocument(type: CustomerType, document: string | null) {
  if (!document) return;
  if (type === "PF" && !isValidCpf(document)) {
    throw new BusinessRuleError("CPF inválido.");
  }
  if (type === "PJ" && !isValidCnpj(document)) {
    throw new BusinessRuleError("CNPJ inválido.");
  }
}

type NormalizedCustomer = {
  name: string;
  type: CustomerType;
  document: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  origin: string | null;
  segment: string | null;
  notes: string | null;
  tags: string[];
  status: CustomerStatus;
  ownerId: string | null;
  lastContactAt: Date | null;
  nextContactAt: Date | null;
};

function normalizeInput(input: CustomerInput): NormalizedCustomer {
  const name = input.name.trim();
  if (!name) throw new BusinessRuleError("Informe o nome do cliente.");

  const document = onlyDigits(input.document);
  assertValidDocument(input.type, document);

  return {
    name,
    type: input.type,
    document,
    email: normalizeEmail(input.email),
    phone: onlyDigits(input.phone),
    whatsapp: onlyDigits(input.whatsapp),
    address: normalizeText(input.address),
    city: normalizeText(input.city),
    state: normalizeText(input.state)?.toUpperCase() ?? null,
    zipCode: onlyDigits(input.zipCode),
    origin: normalizeText(input.origin),
    segment: normalizeText(input.segment),
    notes: normalizeText(input.notes),
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    status: input.status ?? "ACTIVE",
    ownerId: input.ownerId || null,
    lastContactAt: input.lastContactAt ?? null,
    nextContactAt: input.nextContactAt ?? null,
  };
}

// --- detecção de duplicidade (CUST-2) ---------------------------------------

/**
 * Checa clientes existentes com o mesmo e-mail, telefone ou CPF/CNPJ
 * (normalizados). Nunca bloqueia sozinha — quem decide se é mesmo um novo
 * cadastro é o usuário (Etapa 2, fluxo "Detecção de duplicidade de cliente").
 */
export async function findDuplicateCustomers(input: {
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  excludeId?: string;
}): Promise<DuplicateMatch[]> {
  const email = normalizeEmail(input.email);
  const phone = onlyDigits(input.phone);
  const document = onlyDigits(input.document);

  if (!email && !phone && !document) return [];

  const or: Prisma.CustomerWhereInput[] = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (document) or.push({ document });

  const candidates = await prisma.customer.findMany({
    where: {
      OR: or,
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: { id: true, name: true, email: true, phone: true, document: true },
  });

  return candidates.map((c) => {
    const matchedFields: DuplicateField[] = [];
    if (email && c.email === email) matchedFields.push("email");
    if (phone && c.phone === phone) matchedFields.push("phone");
    if (document && c.document === document) matchedFields.push("document");
    return { id: c.id, name: c.name, matchedFields };
  });
}

async function resolveCompanyId(
  companyName: string | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  const name = companyName?.trim();
  if (!name) return null;

  const existing = await tx.company.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing.id;

  const created = await tx.company.create({ data: { name } });
  return created.id;
}

// --- operações ----------------------------------------------------------------

export async function createCustomer(
  input: CustomerInput & { confirmedDuplicate?: boolean },
  actorUserId: string,
): Promise<CreateCustomerResult> {
  const normalized = normalizeInput(input);

  if (!input.confirmedDuplicate) {
    const duplicates = await findDuplicateCustomers({
      email: normalized.email,
      phone: normalized.phone,
      document: normalized.document,
    });
    if (duplicates.length > 0) {
      return { status: "duplicate", duplicates };
    }
  }

  const customer = await prisma.$transaction(async (tx) => {
    const companyId = await resolveCompanyId(input.companyName, tx);
    const created = await tx.customer.create({
      data: { ...normalized, companyId },
    });
    await recordAudit(
      {
        entityType: "customer",
        entityId: created.id,
        action: "customer.create",
        after: { ...normalized, companyName: input.companyName ?? null },
        reason: input.confirmedDuplicate
          ? "Cadastro confirmado pelo usuário apesar de possível duplicidade."
          : undefined,
        userId: actorUserId,
      },
      tx,
    );
    return created;
  });

  return { status: "created", customer };
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
  actorUserId: string,
): Promise<Customer> {
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before) throw new BusinessRuleError("Cliente não encontrado.");

  const normalized = normalizeInput(input);

  const updated = await prisma.$transaction(async (tx) => {
    const companyId = await resolveCompanyId(input.companyName, tx);
    const after = await tx.customer.update({
      where: { id },
      data: { ...normalized, companyId },
    });
    await recordAudit(
      {
        entityType: "customer",
        entityId: id,
        action: "customer.update",
        before: {
          name: before.name,
          email: before.email,
          phone: before.phone,
          document: before.document,
          status: before.status,
        },
        after: {
          name: after.name,
          email: after.email,
          phone: after.phone,
          document: after.document,
          status: after.status,
        },
        userId: actorUserId,
      },
      tx,
    );
    return after;
  });

  return updated;
}

export async function listCustomers() {
  return prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
    },
  });
}

export async function getCustomerById(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
    },
  });
}
