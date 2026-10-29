/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ["better-sqlite3"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};
