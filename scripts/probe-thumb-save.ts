import { readFileSync } from 'node:fs';
import { parseProject } from '../shared/schema/project';
import { persistenceMismatches } from '../shared/project-persistence';

const file = 'C:/Users/ry0ch/デスクトップ/VCV/VCV/CVCS/projects/7a6177c7-8212-43aa-9683-9e326b41fc22/project.json';
const raw = JSON.parse(readFileSync(file, 'utf8')) as {
  captions: Array<{ id: string; thumbText?: { ja: string; en: string } }>;
};

const report = (name: string, project: unknown): void => {
  try {
    const parsed = JSON.parse(JSON.stringify(parseProject(structuredClone(project)))) as unknown;
    const mismatches = persistenceMismatches(project, parsed);
    console.log(name, mismatches.length ? mismatches.join(' | ') : 'OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(name, 'THROW', message.slice(0, 500));
  }
};

report('as saved', raw);

const loaded = parseProject(structuredClone(raw));
const hook = loaded.captions.find((caption) => caption.id === 'hook');
if (!hook) throw new Error('no hook');
hook.thumbText = { ja: 'ヘイヴンC\nまずはこれ', en: '' };
const before = JSON.stringify(hook.thumbText);
const stamped = { ...loaded, updatedAt: '2026-10-07T00:00:00.000Z' };
const parsed = parseProject(stamped);
const afterInput = JSON.stringify(hook.thumbText);
const afterParsed = JSON.stringify(parsed.captions.find((caption) => caption.id === 'hook')?.thumbText);
console.log('input before', before);
console.log('input after parse', afterInput);
console.log('parsed thumb', afterParsed);
report('loaded then edited same refs', stamped);
