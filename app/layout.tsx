import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OnePercent — AI Trading Terminal",
  description: "AI-powered Polymarket trader. NBA Live Edge.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${jetbrainsMono.variable} ${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
