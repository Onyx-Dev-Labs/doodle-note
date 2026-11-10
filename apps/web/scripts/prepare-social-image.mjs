/**
 * Prepare a self-contained 1200x630 capture of the built homepage hero.
 * Run from apps/web after a production build:
 *   node scripts/prepare-social-image.mjs .next-build
 * Render the emitted HTML at 1200x630, after document.fonts.ready, as PNG.
 * See docs/social-preview.md. This script never contacts a service or uses notes.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const build = path.resolve(process.argv[2] || ".next");
const source = await readFile(path.join(build, "server/app/index.html"), "utf8");
const header = source.match(/<header class="site-header wrap">[\s\S]*?<\/header>/)?.[0];
const hero = source.match(/<section class="hero wrap">[\s\S]*?<\/section>/)?.[0];
if (!header || !hero) throw new Error("Expected homepage header and hero in the fresh production build.");

const styles = [];
for (const tag of source.matchAll(/<link\b[^>]*>/g)) {
  if (!tag[0].includes('rel="stylesheet"')) continue;
  const href = tag[0].match(/href="([^"]+)"/)?.[1];
  if (!href?.startsWith("/_next/static/")) continue;
  const cssPath = path.join(build, href.slice("/_next/".length));
  let css = await readFile(cssPath, "utf8");
  // The English homepage needs only the Latin display/body/handwriting fonts.
  // Keep the review artifact compact without changing those real typefaces.
  css = css.replace(/@font-face\{[^}]+\}/g, (face) =>
    /font-family:Geist Mono/.test(face) || !/unicode-range:U\+(\?\?|0000-00FF)/.test(face)
      ? ""
      : face,
  );
  const fonts = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)];
  for (const [url, fontPath] of fonts) {
    const font = await readFile(path.resolve(path.dirname(cssPath), fontPath));
    css = css.replace(url, `url(data:font/woff2;base64,${font.toString("base64")})`);
  }
  styles.push(css);
}
if (!styles.length) throw new Error("No built homepage styles found.");

const mascot = await readFile("public/mascot.png");
const markup = (header + hero).replaceAll('src="/mascot.png"', `src="data:image/png;base64,${mascot.toString("base64")}"`);

// Only reframe the homepage for the share aspect ratio. All illustration,
// headline, logo, typefaces, and colors come from the real built homepage.
const css = `
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
.marketing {
  --font-bricolage: 'Bricolage Grotesque'; --font-caveat: 'Caveat';
  --font-geist-sans: 'Geist'; --font-geist-mono: 'Geist Mono';
  width: 1200px; height: 630px; min-height: 0;
}
.marketing .wrap { width: 1096px; }
.marketing .site-header { height: 108px; }
.marketing .brand { font-size: 30px; }
.marketing .brand-symbol { width: 48px; height: 48px; }
.marketing .brand-symbol img { width: 45px; height: 45px; }
.marketing .desktop-nav, .marketing .header-actions,
.marketing .hero .download-actions, .marketing .hero-demo-links { display: none; }
.marketing .site-header::after {
  content: 'doodlenote.ai'; color: #c8d5bf; font-size: 16px; letter-spacing: .3px;
}
.marketing .hero {
  height: 522px; min-height: 0; padding: 0;
  position: relative;
  grid-template-columns: 535px 545px; gap: 16px;
}
.marketing .hero-copy { padding: 0 0 20px; }
.marketing .hero h1 { font-size: 53px; letter-spacing: -2.5px; margin: 24px 0 32px; }
.marketing .hero-description { font-size: 17px; max-width: 455px; margin-bottom: 28px; }
.marketing .hero-footnote { font-size: 12px; margin-top: 0; }
.marketing .hero-art { position: absolute; left: 551px; top: 18px; width: 640px; height: 550px; transform: scale(.82); transform-origin: left top; }
.marketing .hero-note { left: 52px; top: 64px; }
.marketing .back-sheet { left: 49px; top: 76px; }
.marketing .top-annotation { top: 18px; left: 24px; }
.marketing .annotation-arrow { top: 44px; }
.marketing .sticky-note { right: -3px; bottom: 48px; }
.marketing .mascot-sticker { left: 0; bottom: 14px; }
.marketing *, .marketing *::before, .marketing *::after { animation: none !important; transition: none !important; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DoodleNote homepage share image</title><style>${styles.join("\n")}\n${css}</style></head><body><div class="marketing">${markup}</div><script>
Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]).then(() => {
  console.log(JSON.stringify({
    width: document.body.scrollWidth, height: document.body.scrollHeight,
    fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
    imagesLoaded: [...document.images].every(i => i.complete && i.naturalWidth > 0)
  }));
});
</script></body></html>`;
const output = path.join(build, "homepage-share.html");
await writeFile(output, html);
console.log(output);
