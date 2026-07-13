import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/auth/services/permissions", () => ({
  userHasPermission: vi.fn(),
}));

import { auth } from "@/auth";
import { userHasPermission } from "@/modules/auth/services/permissions";
import {
  ForbiddenError,
  UnauthorizedError,
  requirePermission,
  requireSession,
} from "@/modules/auth/services/guard";

const mockedAuth = vi.mocked(auth);
const mockedHasPermission = vi.mocked(userHasPermission);

describe("requirePermission", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedHasPermission.mockReset();
  });

  it("throws UnauthorizedError when there is no session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(requirePermission("users.manage")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when the user lacks the permission", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockedHasPermission.mockResolvedValue(false);
    await expect(requirePermission("users.manage")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the userId when the permission is granted", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockedHasPermission.mockResolvedValue(true);
    await expect(requirePermission("users.manage")).resolves.toEqual({ userId: "u1" });
  });
});

describe("requireSession", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
  });

  it("throws UnauthorizedError without a session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the userId with a valid session, regardless of permission", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    await expect(requireSession()).resolves.toEqual({ userId: "u2" });
  });
});
