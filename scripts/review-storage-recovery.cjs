// Focused unit checks for storage recovery; no account data or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/app/core/local-data.ts', 'utf8');
const functionSource = source.slice(source.indexOf('async function database()'), source.indexOf('async function record('))
  .replace('new Promise<IDBDatabase>', 'new Promise');
function open() {
  let closes = 0;
  const request = { result: { close() { closes++; } } };
  const run = vm.runInNewContext(`const DB='test',STORE='account'; ${functionSource}; database`, { indexedDB: { open() { return request; } } });
  return { request, promise: run(), closes: () => closes };
}
(async () => {
  const older = open(); older.request.error = { name: 'VersionError' }; older.request.onerror();
  await assert.rejects(older.promise, /pantalla es anterior.*No borres/);
  const blocked = open(); blocked.request.onblocked();
  await assert.rejects(blocked.promise, /Otra pestaña.*conservan/);
  blocked.request.onsuccess(); assert.equal(blocked.closes(), 1);
  const success = open(); success.request.onsuccess(); await success.promise;
  success.request.result.onversionchange(); assert.equal(success.closes(), 1);
  const denied = open(); denied.request.error = { name: 'SecurityError' }; denied.request.onerror();
  await assert.rejects(denied.promise, /navegador permita guardar/);
  console.log('5 comprobaciones de recuperación de almacenamiento correctas. Sin modificar datos.');
})().catch(error => { console.error(error); process.exitCode = 1; });
