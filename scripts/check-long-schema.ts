import { persistenceMismatches } from '../shared/project-persistence';
import { LongProjectVersionError, parseLongProject } from '../shared/long/schema';
import { createDefaultProject, NewerProjectError, parseProject } from '../shared/schema/project';
import { baseProject, expect, expectEqual, fail } from './long-test-utils';

// --- 往復で値を失わない
const project = baseProject();
const serialized = JSON.parse(JSON.stringify(parseLongProject(JSON.parse(JSON.stringify(project)))));
expectEqual(persistenceMismatches(project, serialized), [], '保存→再読込で欠落しない');
expectEqual(serialized.format, 'long', '制作形式を保存');
expectEqual(serialized.output.width, 1920, '出力幅');
expectEqual(serialized.output.height, 1080, '出力高さ');

// --- 未知の新しい版は拒否（書き換えない）
try {
  parseLongProject({ ...serialized, longSchemaVersion: 99 });
  fail('新しい版の横動画を拒否していない');
} catch (error) {
  expect(error instanceof LongProjectVersionError, '新しい版はバージョンエラー');
}

// --- 短尺の project.json は横動画として読まない
const short = createDefaultProject('short-1', '2026-10-31T00:00:00.000Z');
try {
  parseLongProject(short);
  fail('短尺 Project を横動画として読んだ');
} catch (error) {
  expect(error instanceof Error && error.message.includes('横動画プロジェクトではありません'), '短尺は横動画として読まない');
}

// --- 短尺の parseProject：形式のない既存データはショートのまま（schemaVersion 7）
const shortParsed = parseProject(JSON.parse(JSON.stringify(short)));
expectEqual(shortParsed.schemaVersion, 7, '短尺のスキーマ番号は変えない');
expectEqual(shortParsed.templateId, 't-std', '短尺のテンプレートは変えない');

// --- 短尺側：より新しい schemaVersion は旧形式として書き換えず拒否
try {
  parseProject({ ...JSON.parse(JSON.stringify(short)), schemaVersion: 8 });
  fail('schemaVersion 8 を旧形式として読み替えた');
} catch (error) {
  expect(error instanceof NewerProjectError, '新しい短尺形式はバージョンエラー');
}

// --- 横動画を短尺として読まない
try {
  parseProject(serialized);
  fail('横動画を短尺として読んだ');
} catch (error) {
  expect(error instanceof Error && error.message.includes('横動画'), '横動画は短尺として読まない');
}

console.log('long schema ok');
