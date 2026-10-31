const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apjtr-persist-'));
  const port = 34000 + Math.floor(Math.random() * 10000);
  const password = 'CI-persist-password-12345';
  let child;
  const base = 'http://127.0.0.1:' + port;
  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, ADMIN_PASSWORD: password, DATA_DIR: dataDir, PORT: String(port) },
      stdio: 'ignore'
    });
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(base + '/');
        if (r.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Server did not become ready');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  async function login() {
    const r = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password })
    });
    assert.equal(r.status, 200, 'login after server restart succeeds');
    return r.headers.get('set-cookie').split(';')[0];
  }
  try {
    await start();
    let cookie = await login();
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    let r = await fetch(base + '/api/records/students', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Persistence CI Student', class: '7', parent: 'Synthetic', status: 'નિયમિત' })
    });
    assert.equal(r.status, 201);
    const record = await r.json();

    const bytes = Buffer.from('%PDF-1.7\\nPersistence fixture');
    r = await fetch(base + '/api/files', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'persistence.pdf', type: 'application/pdf', data: bytes.toString('base64') })
    });
    assert.equal(r.status, 201);
    const file = await r.json();

    await stop();
    await start();
    cookie = await login();
    const authHeaders = { Cookie: cookie };

    r = await fetch(base + '/api/records/students', { headers: authHeaders });
    assert.equal(r.status, 200);
    const records = await r.json();
    assert.ok(records.some(item => item.id === record.id), 'SQLite record survives restart');

    r = await fetch(base + '/api/files/' + file.id, { headers: authHeaders });
    assert.equal(r.status, 200);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes, 'uploaded file survives restart');
    console.log('Persistence restart checks passed');
  } finally {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
