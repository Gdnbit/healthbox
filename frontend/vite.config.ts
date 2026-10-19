// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const viteEnvironment = loadEnv(
  process.env.NODE_ENV || 'development',
  __dirname,
  ''
);
const developmentApiTarget =
  viteEnvironment.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Enable JSX in .js files for gradual migration from CRA
      include: '**/*.{jsx,js,tsx,ts}',
      jsxRuntime: 'automatic',
    }),
    svgr(), // Allows importing SVGs as React components
    tsconfigPaths(), // Respects tsconfig baseUrl: "src"
    // Bundle the household default (Chinese) and the upstream fallback (English)
    // synchronously without importing files directly from Vite's public directory.
    {
      name: 'bundled-core-locales',
      resolveId(id) {
        if (id === 'virtual:bundled-core-locales') return '\0' + id;
        return null;
      },
      load(id) {
        if (id !== '\0virtual:bundled-core-locales') return null;
        const localeEntries = ['en', 'zh'].map(locale => {
          const dir = path.resolve(__dirname, `public/locales/${locale}`);
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
          const namespaces = files.map(f => {
            const ns = f.replace(/\.json$/, '');
            const fullPath = path.join(dir, f);
            this.addWatchFile(fullPath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            return `    ${JSON.stringify(ns)}: ${content}`;
          });
          return `  ${JSON.stringify(locale)}: {\n${namespaces.join(',\n')}\n  }`;
        });
        return `export default {\n${localeEntries.join(',\n')}\n};\n`;
      },
      handleHotUpdate({ file, server }) {
        const localesDir = path
          .resolve(__dirname, 'public/locales')
          .replace(/\\/g, '/')
          .replace(/\/$/, '');
        const normalized = file.replace(/\\/g, '/');
        const isInsideLocalesDir = normalized.startsWith(localesDir + '/');
        const relativePath = normalized.slice(localesDir.length + 1);
        const locale = relativePath.split('/')[0];
        if (
          !isInsideLocalesDir ||
          !['en', 'zh'].includes(locale) ||
          !normalized.endsWith('.json')
        ) {
          return;
        }
        const mod = server.moduleGraph.getModuleById(
          '\0virtual:bundled-core-locales'
        );
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      },
    },
    // Inject build version into service-worker.js so the browser detects SW updates
    {
      name: 'sw-version-inject',
      apply: 'build',
      writeBundle(options) {
        const outDir = options.dir || path.resolve(__dirname, 'build');
        const swPath = path.join(outDir, 'service-worker.js');
        if (!fs.existsSync(swPath)) {
          this.warn(
            'service-worker.js not found in build output — SW version injection skipped'
          );
          return;
        }
        let content = fs.readFileSync(swPath, 'utf-8');
        if (!content.includes('__SW_VERSION__')) {
          this.warn(
            '__SW_VERSION__ placeholder not found in service-worker.js — cache versioning will not work'
          );
          return;
        }
        const hash = crypto
          .createHash('md5')
          .update(content + Date.now())
          .digest('hex')
          .slice(0, 10);
        content = content.replace('__SW_VERSION__', hash);
        fs.writeFileSync(swPath, content, 'utf-8');
      },
    },
  ],

  // Development server configuration
  server: {
    port: 3000,
    // Allow local design-QA and CI previews to start without launching the user's browser.
    open: process.env.VITE_NO_OPEN !== '1',
    hmr: {
      overlay: true, // Show errors in browser overlay
    },
    watch: {
      // Ignore node_modules and build directories to prevent unnecessary reloads
      ignored: [
        '**/node_modules/**',
        '**/build/**',
        '**/dist/**',
        '**/.git/**',
      ],
    },

    // Proxy configuration for API requests
    proxy: {
      '/api': {
        target: developmentApiTarget,
        changeOrigin: true,
        secure: false,
        // Preserve headers including Authorization
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // Ensure Authorization header is forwarded
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
          });
        },
      },
    },
  },

  // Build configuration
  build: {
    outDir: 'build',
    sourcemap: false,

    // Chunk size warnings
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk for React and related libraries
          vendor: ['react', 'react-dom', 'react-router-dom'],

          // Mantine UI library (your primary UI framework)
          mantine: [
            '@mantine/core',
            '@mantine/hooks',
            '@mantine/form',
            '@mantine/dates',
            '@mantine/notifications',
            '@mantine/dropzone',
          ],

          // Chart libraries
          charts: ['chart.js', 'react-chartjs-2', 'recharts'],

          // Icons
          icons: ['@tabler/icons-react', 'lucide-react'],

          // i18n
          i18n: ['i18next', 'react-i18next', 'i18next-http-backend'],
        },
      },
    },
  },

  // Optimize dependencies (pre-bundle for faster dev server)
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@mantine/core',
      '@mantine/hooks',
      'i18next',
      'react-i18next',
    ],
  },

  // Resolve configuration
  resolve: {
    alias: {
      // tsconfig-paths plugin handles baseUrl: "src" from tsconfig.json
      // No need to manually add `'@': path.resolve(__dirname, './src')`

      // Shared data directory (single source of truth for test library, etc.)
      // NOTE: This alias is defined for IDE support and potential future use.
      // In actual imports, we use relative paths (e.g., '../../../shared/data/test_library.json')
      // for better Docker build compatibility where alias resolution can be unreliable.
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
