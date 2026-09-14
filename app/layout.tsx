import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JD × 简历 · 打招呼助手",
  description: "上传简历与JD，自动解析并生成 Boss 直聘风格打招呼语",
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
