import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build id, so a running tab can tell it is out of date.
 *
 * Fred keeps the CRM open while work is deployed underneath him. His browser
 * holds whatever bundle it loaded when he opened the tab, so after a deploy
 * he is running old code against a moved API — which surfaces as confusing
 * breakage rather than as "reload me".
 *
 * The same value is compiled into the bundle and written to a tiny
 * version.json beside it. The app fetches that file and compares: different
 * means a deploy has happened since this tab loaded. It costs one small
 * request and needs nothing remembered by anyone.
 */
const BUILD_ID = new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId: BUILD_ID }),
        })
      },
    },
  ],
})
