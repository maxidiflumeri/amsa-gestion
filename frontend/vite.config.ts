import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
