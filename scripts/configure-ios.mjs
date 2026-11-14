import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const plistUrl = new URL('../ios/App/App/Info.plist', import.meta.url);
if (!existsSync(plistUrl)) throw new Error('iOS project not found. Run npm run mobile:add:ios first.');

let plist = await readFile(plistUrl, 'utf8');
const entries = [
  ['NSLocationWhenInUseUsageDescription', 'Pawstop uses your location to start a trip from where you are.'],
  ['NSLocationAlwaysAndWhenInUseUsageDescription', 'Pawstop uses your location to start a trip from where you are.']
];

for (const [key, value] of entries) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  plist = plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`);
}

await writeFile(plistUrl, plist);
console.log('Configured Pawstop iOS location permission descriptions.');
