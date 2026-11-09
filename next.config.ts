import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "pdfjs-dist", "mammoth"],
  // PDF.js loads these at runtime; automatic tracing misses the native canvas
  // binding and worker, which otherwise disappear from the Vercel function.
  outputFileTracingIncludes: {
    "/api/extract": [
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/pdf-parse/dist/pdf-parse/{cjs,esm}/pdf.worker.mjs",
      "./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
