import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
try {
 const page = await browser.newPage();
 await page.route('**/native-check', r => r.fulfill({ contentType: 'text/html', body: '<html><body>Native bridge regression</body></html>' }));
 await page.addInitScript(() => {
  window.CapacitorCustomPlatform = { name: 'ios' };
  window.calls = [];
  window.resizeMode = 'native';
  window.failAttach = false;
  window.failRows = false;
  window.resumed = false;
  const methods = {
   NativeComposer: ['listAttach','listRows','listSet','listScrollTo','listDetach'],
   Keyboard: ['getResizeMode','setResizeMode'],
  };
  window.Capacitor = {
   PluginHeaders: Object.entries(methods).map(([name, names]) => ({ name, methods: names.map(name => ({ name, rtype: 'promise' })) })),
   nativePromise: async (plugin, method, args) => {
    window.calls.push({ plugin, method, args, phase: 'start' });
    await new Promise(r => setTimeout(r, method === 'listRows' ? 40 : 5));
    if (method === 'setResizeMode') window.resizeMode = args.mode;
    if (method === 'listAttach' && window.failAttach) throw Error('attach failed');
    if (method === 'listRows' && window.failRows) throw Error('rows failed');
    window.calls.push({ plugin, method, args, phase: 'end' });
    if (method === 'getResizeMode') return { mode: window.resizeMode };
    if (method === 'listDetach') return { atBottom: false, topId: 'm7', off: -0.375 };
    if (method === 'listAttach') return { ok: true, resumed: window.resumed };
    return { ok: true };
   },
  };
 });
 await page.goto('http://localhost:5199/native-check');
 const result = await page.evaluate(async () => {
  const { ncLog } = await import('/src/lib/composer.ts');
  const q = await import('/src/lib/chatlist.ts');
  ncLog.ready = true; ncLog.v = 41;
  const defaults = q.listOn(); q.setListOn(false); const off = q.listOn();
  q.setListOn(true); const on = q.listOn();
  const attached = await q.listAttach({ hidden: true });
  window.resumed = true;
  const resumed = await q.listAttach({ session: 'user:room', hidden: true });
  const during = window.resizeMode;
  window.calls = [];
  await Promise.all([q.listRows([{ id:'m7', kind:'text', body:'hello' }], true), q.listScrollTo('m7','at',false,13), q.listSet({hidden:false})]);
  const sequence = window.calls.map(c => c.method+':'+c.phase);
  const spot = await q.listDetach(); const after = window.resizeMode;
  window.failAttach = true;
  const failedAttach = await q.listAttach({}); const afterFailure = window.resizeMode;
  window.failAttach = false;
  await q.listAttach({}); window.failRows = true;
  const failedRows = await q.listRows([],true);
  window.failRows = false;
  const recovered = await q.listRows([],true);
  const d = q.listDetach(); const a = q.listAttach({});
  await Promise.all([d,a]); const reentered = window.resizeMode;
  await q.listDetach();
  ncLog.v = 40; localStorage.removeItem('teetime:nc-list');
  const oldDefault = q.listOn(); window.calls = [];
  await q.listAttach({}); await q.listDetach();
  const oldKeyboardCalls = window.calls.filter(c => c.plugin === 'Keyboard').length;
  return { defaults, off, on, attached, resumed, during, sequence, spot, after, failedAttach, afterFailure, failedRows, recovered, reentered, oldDefault, oldKeyboardCalls };
 });
 assert.equal(result.defaults,true); assert.equal(result.off,false); assert.equal(result.on,true);
 assert.deepEqual(result.attached,{ok:true,resumed:false}); assert.equal(result.during,'none');
 assert.deepEqual(result.resumed,{ok:true,resumed:true});
 assert.deepEqual(result.sequence,['listRows:start','listRows:end','listScrollTo:start','listScrollTo:end','listSet:start','listSet:end']);
 assert.deepEqual(result.spot,{id:'m7',off:-0.375}); assert.equal(result.after,'native');
 assert.deepEqual(result.failedAttach,{ok:false,resumed:false}); assert.equal(result.afterFailure,'native');
 assert.equal(result.failedRows,false); assert.equal(result.recovered,true);
 assert.equal(result.reentered,'none'); assert.equal(result.oldDefault,false); assert.equal(result.oldKeyboardCalls,0);
 console.log('PASS: native defaults, opt-out, ordered rows/restore/reveal, resize lease, attach failure, row failure recovery, rapid re-entry, old app compatibility');
} finally { await browser.close(); }
