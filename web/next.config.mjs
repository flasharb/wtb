/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is for the Docker image (Phase 3). Enabled via env so local Windows builds
  // aren't blocked by symlink permissions (EPERM); CI/Docker on Linux set BUILD_STANDALONE=1.
  ...(process.env.BUILD_STANDALONE ? { output: 'standalone' } : {}),
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true }, // type safety still enforced by tsc/next build
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
