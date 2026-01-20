import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// 1. On importe l'outil d'analyse
import { Analytics } from "@vercel/analytics/react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pictopost - Générateur Viral IA",
  description: "Transformez vos photos en posts viraux pour TikTok, Insta et Facebook.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${inter.className} bg-slate-950 text-white`}>
        {children}
        {/* 2. On place le composant ici. Il est invisible mais compte les visiteurs. */}
        <Analytics />
      </body>
    </html>
  );
}