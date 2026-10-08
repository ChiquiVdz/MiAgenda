import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QuickCapture } from "./core/quick-capture";
import { MobileViewport } from "./core/use-mobile-layout";
import { LocalWorkspace } from "./core/local-workspace";

export const metadata: Metadata = {
  title: "MiAgenda | Tu semana, en orden",
  description: "Organiza tus actividades, horarios y cocina en MiAgenda.",
  applicationName: "MiAgenda",
  appleWebApp: { capable: true, title: "MiAgenda", statusBarStyle: "default" },
  icons: {
    icon: "/icons/icon-192.png",
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#41664d" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX">
      <body><MobileViewport /><LocalWorkspace>{children}</LocalWorkspace><QuickCapture /></body>
    </html>
  );
}
