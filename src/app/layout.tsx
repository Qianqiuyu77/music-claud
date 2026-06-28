import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 私人歌单",
  description: "基于真实网易云音乐曲库的本地推荐工作台"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
