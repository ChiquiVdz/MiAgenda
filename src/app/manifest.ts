import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MiAgenda",
    short_name: "MiAgenda",
    description: "Tus actividades, agenda y cocina en un solo lugar.",
    lang: "es-MX",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f4",
    theme_color: "#41664d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
