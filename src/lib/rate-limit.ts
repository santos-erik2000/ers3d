/**
 * Rate limiting em memória para o endpoint de login (Etapa 3, seção 01).
 *
 * Decisão consciente: nesta escala (uma instância Render, ~20 clientes ativos),
 * um limitador em memória de processo é suficiente e evita depender de Redis,
 * que foi deliberadamente adiado (Etapa 1 — arquitetura). Trade-off documentado:
 * não é compartilhado entre instâncias e reseta a cada deploy/restart. Se a
 * aplicação algum dia escalar horizontalmente, isto precisa migrar para Redis.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
