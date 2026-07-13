"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/auth";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { BusinessRuleError, blockUser, createUser, unblockUser } from "@/modules/auth/services/users";

export async function loginAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return "E-mail ou senha inválidos.";
      }
      return error.message || "Não foi possível entrar. Tente novamente.";
    }
    throw error;
  }
  return undefined;
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function createUserAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const { userId } = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const roleSlug = String(formData.get("roleSlug") ?? "");

  if (!name || !email || !roleSlug) return "Preencha nome, e-mail e perfil.";
  if (password.length < 8) return "A senha precisa ter ao menos 8 caracteres.";

  try {
    await createUser({ name, email, password, roleSlug }, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return error.message;
    throw error;
  }

  revalidatePath("/usuarios");
  return undefined;
}

export async function blockUserAction(targetUserId: string): Promise<void> {
  const { userId } = await requirePermission(PERMISSIONS.USERS_MANAGE);
  await blockUser(targetUserId, userId);
  revalidatePath("/usuarios");
}

export async function unblockUserAction(targetUserId: string): Promise<void> {
  const { userId } = await requirePermission(PERMISSIONS.USERS_MANAGE);
  await unblockUser(targetUserId, userId);
  revalidatePath("/usuarios");
}
