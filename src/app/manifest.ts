import type { MetadataRoute } from 'next';

// Lets the CRM be added to a phone's home screen as an app, which phones need before they show its notifications
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nirmaan WaterTech CRM',
    short_name: 'Nirmaan CRM',
    description: 'Sales Tracker for Nirmaan WaterTech Solutions',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
