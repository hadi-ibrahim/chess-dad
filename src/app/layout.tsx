import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Chess Dad — Open-Source Chess Coach",
  description:
    "Analyze your Lichess and Chess.com games with Stockfish, get plain-language coaching, and train your recurring weaknesses.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full" data-scroll-behavior="smooth">
      <body className="min-h-full bg-zinc-950 text-zinc-100 antialiased">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
