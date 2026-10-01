import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MiAgenda | Tu semana, en orden",
  description: "Una agenda personal conectada con Google Calendar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
