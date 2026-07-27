import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEOS FX — Financial Model",
  description: "Investor-grade AgTech financial model (NEOS design system).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-neos-theme="dark">
      <body>{children}</body>
    </html>
  );
}
