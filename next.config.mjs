/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ["libsql", "@libsql/client"],
  // The schema is read from disk when the database first opens, so it must ship with the server code.
  outputFileTracingIncludes: { "/**": ["./lib/schema.sql"] },
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};
