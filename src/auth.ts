import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import * as argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { isRateLimited, resetRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/modules/audit/services/audit";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        if (isRateLimited(`login:${email}`)) {
          throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.status !== "ACTIVE") {
          await recordAudit({ entityType: "user", entityId: email, action: "login.failed" });
          return null;
        }

        const valid = await argon2.verify(user.passwordHash, password);
        if (!valid) {
          await recordAudit({
            entityType: "user",
            entityId: user.id,
            action: "login.failed",
            userId: user.id,
          });
          return null;
        }

        resetRateLimit(`login:${email}`);
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await recordAudit({
          entityType: "user",
          entityId: user.id,
          action: "login.success",
          userId: user.id,
        });

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
