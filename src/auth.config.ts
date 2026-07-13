import type { NextAuthConfig } from "next-auth";

/**
 * Configuração compatível com o runtime Edge (usada pelo middleware).
 * Não importa nada que dependa de Node puro (Prisma, argon2) — isso fica
 * só em src/auth.ts, que roda em Route Handlers/Server Actions/Server Components.
 */
const PUBLIC_PATHS = ["/login"];

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname, origin } = request.nextUrl;
      const isLoggedIn = Boolean(auth?.user);
      const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

      if (isLoggedIn && pathname === "/login") {
        return Response.redirect(new URL("/dashboard", origin));
      }
      if (!isLoggedIn && !isPublic) {
        return false;
      }
      return true;
    },
  },
};
