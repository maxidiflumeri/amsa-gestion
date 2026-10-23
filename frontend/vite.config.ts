import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Gestión como app instalada (como AMSA Sender). `prompt`: la versión nueva espera a que la persona toque
    // "Actualizar" (src/pwa/AvisoVersionNueva.tsx), no se recarga sola en medio de una gestión.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'AMSA Gestión',
        short_name: 'Gestión',
        description: 'Gestión de cobranzas de AMSA.',
        lang: 'es-AR',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F8FAFC',
        theme_color: '#EDF1F5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Se precarga solo la página base y los íconos: precargar todas las pantallas sería bajar la app entera en
        // el celular la primera vez. El resto (assets/, con hash en el nombre) se guarda a medida que se usa.
        globPatterns: ['index.html', '*.{png,svg,ico}'],
        navigateFallback: 'index.html',
        // La API, los sockets y lo que sirve el backend no son pantallas de la app.
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/socket\.io(\/|$)/, /^\/uploads(\/|$)/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: [
      'recharts',
      '@mui/material',
      '@emotion/react',
      '@emotion/styled',
      '@react-oauth/google',
      'axios',
      'react-router-dom',
    ],
  },
})
