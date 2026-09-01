import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // getUserMedia needs a secure context; localhost counts, LAN IPs do not.
    // Use `npm run dev -- --host` plus a tunnel when testing on a real phone.
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
