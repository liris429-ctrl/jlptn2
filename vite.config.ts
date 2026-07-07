import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.svg"],
      manifest: {
        name: "N2たん - JLPT N2 文法・語彙学習",
        short_name: "N2たん",
        description: "JLPT N2 文法・語彙の検索と連連看ゲームで覚える学習アプリ",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#1c2b2a",
        background_color: "#f6f2ea",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the generated grammar/vocab JSON too, so the app works fully
        // offline right after the first visit (not just after a second fetch).
        globPatterns: ["**/*.{js,css,html,svg,json,woff2}"],
      },
    }),
  ],
});
