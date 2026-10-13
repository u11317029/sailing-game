import { defineConfig } from 'vite';

export default defineConfig({
  base: './',   // 用相對路徑，放在任何網址或子資料夾（例如 GitHub Pages）都能跑
  server: { open: false },
  build: { chunkSizeWarningLimit: 1000 },   // three.js 本身就超過 500 kB，屬正常
});
