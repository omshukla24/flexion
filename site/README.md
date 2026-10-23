# Flexion site

The public site for Flexion: vanilla ES modules on GSAP + ScrollTrigger, Lenis and three.js, bundled by Vite.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # scene maths (node:test)
npm run build      # production bundle in dist/
```

- `src/main.js` boots in page order: preloader, the hero ("The Reading"), then each set-piece in its own chunk.
- `src/scenes/*-math.js` hold the pure maths behind each set-piece and are what the tests cover.
- Append `?reduced` to the URL to see the reduced-motion path.
- "Try it live" imports the product's own camera engine from `../server/app/vision.js`.
