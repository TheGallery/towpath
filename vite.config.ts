import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [
    {
      // `?gallery` on the development server shows a gallery of canals made from seeds instead of the game.
      name: 'gallery',
      apply: 'serve',
      transformIndexHtml: (html, { originalUrl }) => (new URLSearchParams(originalUrl?.split('?')[1]).has('gallery') ? html.replace('/src/main.ts', '/src/gallery.ts') : html),
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
