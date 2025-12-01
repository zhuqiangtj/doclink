import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import SessionLogger from "@/components/SessionLogger";
import UsernameBadge from "@/components/UsernameBadge";

export const metadata: Metadata = {
  title: "DocLink",
  description: "一个用于医疗预约的Next.js应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <head>
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <Providers>
          <SessionLogger />
          <div className="global-badge-stack">
            <UsernameBadge />
          </div>
          <main className="pb-20">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
