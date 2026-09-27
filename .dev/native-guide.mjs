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
