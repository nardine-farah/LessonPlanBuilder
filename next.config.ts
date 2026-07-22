import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // mupdf ships a WASM binary; firebase-admin dislikes bundling — load both
  // from node_modules at runtime instead of tracing them into the bundle.
  serverExternalPackages: ["mupdf", "firebase-admin"],
};

export default nextConfig;
