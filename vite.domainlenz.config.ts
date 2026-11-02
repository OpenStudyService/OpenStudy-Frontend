import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dedicated front-end-only preview. It does not start the OpenStudy app/MSW/API.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "domainlenz-preview-entry",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === "/") request.url = "/domainlenz-demo.html";
          next();
        });
      },
    },
  ],
  publicDir: false,
});
