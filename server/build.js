/**
 * Minify all HTML files in src/public/ → dist/public/
 * Inlines and minifies CSS + JS. Copies non-HTML files as-is.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { minify } from 'html-minifier-terser';

const SRC = 'src/public';
const DIST = 'dist/public';

// Also copy src/*.js to dist/
function copySrc() {
  mkdirSync('dist', { recursive: true });
  for (const f of readdirSync('src')) {
    if (f === 'public') continue;
    const full = join('src', f);
    if (statSync(full).isFile()) copyFileSync(full, join('dist', f));
  }
}

async function buildPublic(dir, outDir) {
  mkdirSync(outDir, { recursive: true });

  for (const file of readdirSync(dir)) {
    const src = join(dir, file);
    const dest = join(outDir, file);

    if (statSync(src).isDirectory()) {
      buildPublic(src, dest);
      continue;
    }

    if (extname(file) === '.html') {
      const html = readFileSync(src, 'utf8');
      const min = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: {
          compress: { drop_console: false, passes: 2 },
          mangle: { toplevel: true },
        },
        removeAttributeQuotes: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        sortAttributes: true,
        sortClassName: true,
      });
      writeFileSync(dest, min);
      const pct = Math.round((1 - min.length / html.length) * 100);
      console.log(`  ${file}: ${html.length} → ${min.length} (${pct}% smaller)`);
    } else {
      copyFileSync(src, dest);
    }
  }
}

console.log('Building...');
copySrc();
await buildPublic(SRC, DIST);
console.log('Done → dist/');
