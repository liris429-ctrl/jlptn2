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
        theme_color: "#c1442c",
        background_color: "#f1f2ec",
        // Transparent icons by design (no maskable variant) - the artwork keeps
        // its own alpha background rather than a solid backdrop being added.
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // Precache the generated grammar/vocab JSON too, so the app works fully
        // offline right after the first visit (not just after a second fetch).
        globPatterns: ["**/*.{js,css,html,png,svg,json,woff2}"],
        // vocab.json grew past workbox's 2 MiB default once the eggrolls N1-N5
        // deck (10,622 entries + examples) replaced the old N2-only source (v9).
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
});
