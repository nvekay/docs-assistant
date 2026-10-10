import type { NextConfig } from 'next';

// The browser only talks to this origin: /api/* is proxied to the NestJS API. That keeps the
// anonymous-user cookie first-party (SameSite=Lax) and avoids CORS in production.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Proxied SSE must not be gzip-buffered, or tokens arrive in one burst at the end
  compress: false,
  // Keeps the dev-mode badge out of screenshots and demos
  devIndicators: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
