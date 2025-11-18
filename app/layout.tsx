import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import SessionLogger from "@/components/SessionLogger";
import PatientCreditBadge from "@/components/PatientCreditBadge";
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
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        <Providers>
          <SessionLogger />
          {/* 患者右上角积分徽标（仅在患者角色显示） */}
          <PatientCreditBadge />
          {/* 右上角显示当前用户名（所有角色） */}
          <UsernameBadge />
          <main className="pb-20">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}