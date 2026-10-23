// pdf-lib for the site's report download: Vite bundles it from server/node_modules into a chunk loaded only on click.
// (The coach page loads the same version from jsdelivr instead; this file isn't used there.)
export { PDFDocument, StandardFonts, rgb } from "pdf-lib";
