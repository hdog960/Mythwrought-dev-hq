import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isSnapshot } from '../src/model.mjs';

const output = 'dist';
const state = process.env.HQ_STATE_DIR || '.local';
const hash = createHash('sha256');
const head = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await rm(output, { recursive: true, force: true });
await cp('src', output, { recursive: true, filter: path => !path.endsWith('sw-template.js') });
const shell = await filesBelow(output);
for (const file of shell) hash.update(file).update(await readFile(join(output, file)));
const template = await readFile('src/sw-template.js', 'utf8');
hash.update(template);
const version = hash.digest('hex').slice(0, 16);
const worker = template
  .replace('__CACHE_VERSION__', version).replace('__SHELL_ASSETS__', JSON.stringify(['./', ...shell.map(name => './' + name)]));
await writeFile(join(output, 'sw.js'), worker);
await writeFile(join(output, 'version.json'), JSON.stringify({ version, head }));
await writeFile(join(output, '.nojekyll'), '');
try {
  const raw = await readFile(join(state, 'snapshot.json'), 'utf8');
  if (Buffer.byteLength(raw) > 8_000_000 || !isSnapshot(JSON.parse(raw))) throw new Error('Invalid public snapshot');
  await mkdir(join(output, 'data'));
  await writeFile(join(output, 'data/snapshot.json'), raw);
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.GITHUB_ACTIONS === 'true') throw error;
}
console.log(`Built HQ ${version} from ${head}`);

async function filesBelow(directory, prefix = '') {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(directory, file) : [file];
  }));
  return groups.flat().sort();
}
