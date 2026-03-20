import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import AppShell from "./AppShell";

export const metadata: Metadata = {
  title: "FlowPay - Financial Operating System",
  description: "AI-driven treasury, payroll, and capital management for modern businesses.",
};

const inlineGlobalCss = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <style id="inline-global-css" dangerouslySetInnerHTML={{ __html: inlineGlobalCss }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
