import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "大肥鱼",
  description: "种稻、煮饭、投喂鲸鱼娘，使用自己的 DeepSeek Key 聊天。",
  icons: {
    icon: "/assets/rice-grains.png",
    shortcut: "/assets/rice-grains.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
