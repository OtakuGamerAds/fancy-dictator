import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** A strict Content-Security-Policy for the built app (the dev server needs inline scripts). */
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:", // blob: for the audio worklet
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self' wss://stt-rt.soniox.com",
  "media-src fd-audio:", // the messages' audio (electron/main.cjs)
].join("; ");

const contentSecurityPolicy: Plugin = {
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
};

export default defineConfig({
  // Relative asset paths so the built page loads from file:// inside Electron.
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy],
  resolve: {
    alias: { "~": path.resolve(__dirname, "src") },
  },
  server: { port: 5183, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
