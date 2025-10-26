import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";
import BottomNav from "@/components/BottomNav";
import SessionLogger from "@/components/SessionLogger";

const geistSans = localFont({
  src: '../public/fonts/Geist-Variable.woff2',
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: '../public/fonts/GeistMono-Variable.woff2',
  variable: "--font-geist-mono",
});

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}
      >
        <Providers>
          <SessionLogger />
          <main className="pb-20">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
