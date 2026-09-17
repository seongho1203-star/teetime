import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
try {
 const page = await browser.newPage();
 await page.route('**/native-check', r => r.fulfill({ contentType: 'text/html', body: '<html><body>Native chat bridge</body></html>' }));
 await page.addInitScript(() => {
  window.CapacitorCustomPlatform = { name: 'ios' };
  window.mode = 'native'; window.owner = ''; window.fail = false;
  const methods = { NativeChat: ['open','close','session','reset'], Keyboard: ['getResizeMode','setResizeMode'] };
  window.Capacitor = {
   PluginHeaders: Object.entries(methods).map(([name, names]) => ({ name, methods: names.map(name => ({ name, rtype: 'promise' })) })),
   nativePromise: async (plugin, method, args) => {
    await new Promise(r => setTimeout(r, 5));
    if (method === 'getResizeMode') return { mode: window.mode };
    if (method === 'setResizeMode') window.mode = args.mode;
    if (method === 'open') { if (window.fail) throw Error('opening failed'); window.owner = args.screen; }
    if (method === 'close' && window.owner === args.screen || method === 'reset') window.owner = '';
    return { ok: true };
   }
  };
 });
 await page.goto('http://localhost:5199/native-check');
 const result = await page.evaluate(async () => {
  const q = await import('/src/lib/native-chat.ts');
  const available = q.hasNativeChat();
  await q.openNativeChat('first', {});
  await q.openNativeChat('second', {});
  await q.closeNativeChat('first');
  const staleClose = [window.owner, window.mode];
  await q.closeNativeChat('second');
  const closed = [window.owner, window.mode];
  await Promise.all([q.openNativeChat('third', {}), q.closeNativeChat('third'), q.openNativeChat('fourth', {})]);
  const rapid = [window.owner, window.mode];
  await q.resetNativeChat();
  window.fail = true;
  await q.openNativeChat('fail', {}).catch(() => {});
  return { available, staleClose, closed, rapid, failedMode: window.mode };
 });
 assert.equal(result.available, true);
 assert.deepEqual(result.staleClose, ['second','none']);
 assert.deepEqual(result.closed, ['','native']);
 assert.deepEqual(result.rapid, ['fourth','none']);
 assert.equal(result.failedMode, 'native');
 console.log('Native chat ownership, rapid transitions, reset, failure recovery: PASS');
} finally { await browser.close(); }
