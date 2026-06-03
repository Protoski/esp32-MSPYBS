/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel necesita que el build no falle por advertencias de ESLint
  eslint:     { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

module.exports = nextConfig;
