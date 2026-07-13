import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERS 3D — Gestão de Soluções e Fabricações",
  description: "CRM operacional da ERS 3D Soluções e Fabricações",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
