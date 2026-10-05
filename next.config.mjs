const basePath = process.env.BASE_PATH || '';
const isVercel = process.env.VERCEL === '1';

export default {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  outputFileTracingExcludes: {
    '/*': ['./data/auth/**/*', './data/training/**/*', './data/history/**/*', './data/trash/**/*', './data/imports/**/*', './data/books/**/images/**/*', './out/**/*', './.env*', './public/books/**/*', './src/generated/**/*'],
  },
  ...(isVercel ? { outputFileTracingIncludes: { '/*': ['./data/books/*/book.json', './data/books/*/chapters/*.md', './data/books/*/image-index.json'] } } : {}),
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
