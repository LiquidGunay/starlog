import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Starlog",
    short_name: "Starlog",
    description: "Clip-first personal knowledge, review, and scheduling workspace.",
    start_url: "/",
    display: "standalone",
    background_color: "#070c1b",
    theme_color: "#0f1a34",
    icons: [
      {
        src: "/icons/starlog-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icons/starlog-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/share-target",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  };
}
