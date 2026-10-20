import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JD × 简历 · 校招匹配助手",
  description: "批量比较岗位匹配度，核对简历证据并生成 Boss 直聘风格打招呼语",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
