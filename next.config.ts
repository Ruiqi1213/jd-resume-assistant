import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "mammoth"],
};

export default nextConfig;
