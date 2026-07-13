import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/modules/audit/services/audit";

function fakeTx() {
  return {
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Prisma.TransactionClient;
}

describe("recordAudit", () => {
  it("writes entityType, entityId, action and userId", async () => {
    const tx = fakeTx();
    await recordAudit(
      { entityType: "user", entityId: "u1", action: "user.block", userId: "actor1" },
      tx,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "user",
        entityId: "u1",
        action: "user.block",
        userId: "actor1",
        reason: undefined,
      }),
    });
  });

  it("defaults userId to null when not provided", async () => {
    const tx = fakeTx();
    await recordAudit({ entityType: "user", entityId: "u1", action: "login.failed" }, tx);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }),
    });
  });

  it("serializes before/after through JSON so only plain data is persisted", async () => {
    const tx = fakeTx();
    await recordAudit(
      {
        entityType: "user",
        entityId: "u1",
        action: "user.create",
        before: undefined,
        after: { status: "ACTIVE", createdAt: new Date("2026-01-01T00:00:00Z") },
      },
      tx,
    );

    const call = (tx.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.data.before).toBeUndefined();
    expect(call.data.after).toEqual({
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
