/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite que el build falle con errores de TypeScript visibles
  typescript: { ignoreBuildErrors: false },
  // Expone sólo variables con prefijo NEXT_PUBLIC_ al cliente
  env: {},
};

module.exports = nextConfig;
