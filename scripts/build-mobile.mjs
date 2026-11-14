import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const out = new URL('../www/', import.meta.url);
const root = new URL('../', import.meta.url);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of ['index.html', 'app.js', 'style.css', 'favicon.svg', 'favicon-96.png']) {
  const source = new URL(file, root);
  if (!existsSync(source)) throw new Error(`Missing mobile asset: ${file}`);
  await cp(source, new URL(file, out));
}

await writeFile(new URL('mobile-build.json', out), JSON.stringify({
  app: 'Pawstop',
  generatedBy: 'scripts/build-mobile.mjs'
}, null, 2) + '\n');

console.log('Built Pawstop mobile web assets in www/');
