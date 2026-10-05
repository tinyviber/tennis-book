import type { MetadataRoute } from 'next';
import { publicPath } from '@/lib/urls';
export default function manifest(): MetadataRoute.Manifest {
  return { name: '私人网球训练', short_name: '网球训练', description: '录像复盘、健身记录与每周练球安排', start_url: publicPath('/training/'), scope: publicPath('/training/'), display: 'standalone', background_color: '#f7f6f1', theme_color: '#4c6b51', icons: [{ src: publicPath('/training-icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: publicPath('/training-icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' }] };
}
