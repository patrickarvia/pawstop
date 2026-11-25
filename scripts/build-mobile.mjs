import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const out = new URL('../www/', import.meta.url);
const root = new URL('../', import.meta.url);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of ['app.js', 'style.css', 'favicon.svg', 'favicon-96.png', 'privacy.html', 'support.html']) {
  const source = new URL(file, root);
  if (!existsSync(source)) throw new Error(`Missing mobile asset: ${file}`);
  await cp(source, new URL(file, out));
}

const sourceHtml = await readFile(new URL('index.html', root), 'utf8');
const mobileHtml = sourceHtml.replace(
  '<script src="app.js"></script>',
  '<script src="native-bridge.js"></script>\n<script src="app.js"></script>'
);
if (mobileHtml === sourceHtml) throw new Error('Unable to inject native bridge into mobile HTML.');
await writeFile(new URL('index.html', out), mobileHtml);

await build({
  entryPoints: [new URL('../mobile/native-bridge.js', import.meta.url).pathname],
  outfile: new URL('native-bridge.js', out).pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['safari15'],
  minify: false,
  sourcemap: false
});

await writeFile(new URL('mobile-build.json', out), JSON.stringify({
  app: 'Pawstop',
  generatedBy: 'scripts/build-mobile.mjs',
  nativeBridge: true
}, null, 2) + '\n');

console.log('Built Pawstop mobile web assets in www/');
