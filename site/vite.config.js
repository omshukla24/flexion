import { defineConfig } from 'vite';

export default defineConfig({
  // "Try it live" runs the product's own vision engine from ../server/app (one copy of the code, no fork).
  server: { fs: { allow: ['.', '../server/app'] } },
  // The method page and the 404 are real pages, so the brand can travel between them with a View Transition.
  build: { rollupOptions: { input: { main: 'index.html', method: 'method.html', missing: '404.html' } } },
});
