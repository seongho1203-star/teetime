import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Keep the native guide derived from the same source as web and iOS.
const source = fs.readFileSync(new URL('../src/lib/guide.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const guide = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const output = process.argv[2];
if (!output) throw new Error('Expected output JSON path');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ intro: guide.GUIDE_INTRO, parts: guide.GUIDE_PARTS, foot: guide.GUIDE_FOOT }));

const courseSource = fs.readFileSync(new URL('../src/lib/courses.ts', import.meta.url), 'utf8');
const courseCode = ts.transpileModule(courseSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const courses = await import(`data:text/javascript;base64,${Buffer.from(courseCode).toString('base64')}`);
fs.writeFileSync(path.join(path.dirname(output), 'courses.json'), JSON.stringify(courses.COURSES));

/* 골프장마다의 코스(`lib/clubs.ts`) — 모집 열기의 `코스` 칩. 코틀린에 또 적지 말 것. */
const clubSource = fs.readFileSync(new URL('../src/lib/clubs.ts', import.meta.url), 'utf8');
const clubs = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(clubSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`);
fs.writeFileSync(path.join(path.dirname(output), 'clubs.json'), JSON.stringify(clubs.CLUB_COURSES));

/* **대화 규칙 꾸러미**(`lib/chat-shared.ts`의 `chatShared()`와 같은 이름) — 반응 그림글자 ·
   이모티콘 목록 · 추천 한도. 안드로이드는 웹뷰를 안 거쳐 `NativeApp.open`으로 받을 길이
   없으므로 빌드 때 여기서 뽑아 `chat-shared.json`으로 담는다(`NativeChatShared.load`).
   원본은 웹 한 곳이다 — 코틀린에 목록을 또 적지 말 것. */
async function load(rel) {
  const code = ts.transpileModule(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import\.meta\.env\.BASE_URL/g, '"./"');
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const stickers = await load('../src/lib/stickers.ts');
const typesSrc = fs.readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8');
const pick = (name) => {
  const m = typesSrc.match(new RegExp(`export const ${name} = (\\[[\\s\\S]*?\\])`));
  if (!m) throw new Error(`${name} not found in types.ts`);
  return Function(`return ${m[1]}`)();
};
const suggestSrc = fs.readFileSync(new URL('../src/lib/suggest.ts', import.meta.url), 'utf8');
const num = (name) => Number(suggestSrc.match(new RegExp(`export const ${name} = (\\d+)`))[1]);
fs.writeFileSync(path.join(path.dirname(output), 'chat-shared.json'), JSON.stringify({
  reactions: pick('REACTIONS'),
  stickers: stickers.STICKER_GROUPS,
  suggest: [],
  suggestMax: num('SUGGEST_MAX'),
  suggestAnim: num('SUGGEST_ANIM'),
  banks: pick('BANKS'),
}));
