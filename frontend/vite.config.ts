import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    // Limit dependency scanning to avoid deep analysis
    entries: ["src/main.tsx"],
    // Disable deep dependency discovery
    force: false,
    // Exclude problematic dependencies from pre-bundling
    exclude: [],
    // Include only necessary dependencies
    include: ["react", "react-dom", "ethers"]
  },
  build: {
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunk splitting to avoid deep analysis
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ethers-vendor': ['ethers']
        }
      }
    },
    // Disable source maps in production to speed up build
    sourcemap: false,
    // Reduce minification work
    minify: 'esbuild'
  },
  // Reduce dependency pre-bundling depth
  ssr: {
    noExternal: []
  }
});


