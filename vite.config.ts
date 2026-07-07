import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "favicon-64.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "N2たん - JLPT N2 文法・語彙学習",
        short_name: "N2たん",
        description: "JLPT N2 文法・語彙の検索と連連看ゲームで覚える学習アプリ",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#0a182c",
        background_color: "#f1f2ec",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the generated grammar/vocab JSON too, so the app works fully
        // offline right after the first visit (not just after a second fetch).
        globPatterns: ["**/*.{js,css,html,png,svg,json,woff2}"],
      },
    }),
  ],
});
