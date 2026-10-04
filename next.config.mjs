const basePath = process.env.BASE_PATH || '';

export default {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  outputFileTracingExcludes: {
    '/*': ['./data/**/*', './content/**/*', './out/**/*', './.env*', './public/books/**/*', './src/generated/**/*'],
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
