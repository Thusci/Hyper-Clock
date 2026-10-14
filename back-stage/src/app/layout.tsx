import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Hyper Clock Control", description: "Q775 项目管理与 Home Assistant 控制" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#090b0f" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
