import { game, git } from '../config/sources.mjs';
import { isSha } from '../src/model.mjs';
import { publicText } from './report.mjs';

export async function inspectChangeScope(pull, allowed, detail) {
  const result = await detail(`/repos/${game}/compare/${pull.base}...${pull.head}?per_page=1`);
  if (result?.base_commit?.sha !== pull.base || !isSha(result.merge_base_commit?.sha) || !Array.isArray(result.files)) {
    throw new Error('Exact candidate change list unavailable');
  }
  const names = result.files.flatMap(file => [file.filename, file.status === 'renamed' ? file.previous_filename : null].filter(Boolean));
  const publicNames = names.map(name => publicText(name, 220)).filter(Boolean);
  const outside = [...new Set(publicNames.filter(name => !allowed.test(name)))];
  const infrastructure = outside.filter(name => /^\.github\/|^(?:tools|scripts)\/|^package(?:-lock)?\.json$/.test(name));
  return { head: pull.head, base: pull.base, complete: result.files.length < 300 && publicNames.length === names.length &&
    !result.files.some(file => !file.filename || (file.status === 'renamed' && !file.previous_filename)),
  outside: outside.slice(0, 15), count: outside.length, infrastructure: infrastructure.length,
  source: git(game, `/compare/${pull.base}...${pull.head}`) };
}
