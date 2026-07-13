// Helpers de formatação para exibição (não são regra de negócio — a
// normalização "de verdade" para persistência/comparação vive em
// services/customers.ts). Puros, sem Prisma, usáveis em client ou server.

export function formatDocument(type: "PF" | "PJ", document: string | null | undefined): string {
  if (!document) return "—";
  const digits = document.replace(/\D/g, "");
  if (type === "PF" && digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (type === "PJ" && digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return document;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return phone;
}
