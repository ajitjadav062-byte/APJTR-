const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apjtr-test-'));
  const port = 33000 + Math.floor(Math.random() * 10000);
  const password = 'CI-test-password-12345';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ADMIN_PASSWORD: password, DATA_DIR: dataDir, PORT: String(port) },
    stdio: 'ignore'
  });
  const base = 'http://127.0.0.1:' + port;
  let cookie = '';
  async function request(route, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  }
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(base + '/');
        if (r.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'server starts and serves homepage');

    let r = await request('/api/files');
    assert.equal(r.status, 401, 'file API requires authentication');

    r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password })
    });
    assert.equal(r.status, 200, 'admin login succeeds');

    const sample = Buffer.from('APJ-TR test file');
    r = await request('/api/files', {
      method: 'POST',
      body: JSON.stringify({
        name: 'test.txt',
        type: 'text/plain',
        data: sample.toString('base64')
      })
    });
    assert.equal(r.status, 201, 'allowed text file uploads');
    const uploaded = await r.json();

    r = await request('/api/files/' + uploaded.id);
    assert.equal(r.status, 200, 'uploaded file downloads');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), sample.toString(), 'downloaded bytes match');

    r = await request('/api/files', {
      method: 'POST',
      body: JSON.stringify({
        name: 'bad.exe',
        type: 'application/x-msdownload',
        data: sample.toString('base64')
      })
    });
    assert.equal(r.status, 400, 'unsupported file type is rejected');

    r = await request('/api/files/' + uploaded.id, { method: 'DELETE' });
    assert.equal(r.status, 200, 'file deletion succeeds');

    r = await request('/api/records/students', {
      method: 'POST',
      body: JSON.stringify({ name: 'Synthetic CI Student', class: '6', parent: 'CI', status: 'નિયમિત' })
    });
    assert.equal(r.status, 201, 'record creation succeeds');
    const record = await r.json();

    r = await request('/api/records/students');
    const rows = await r.json();
    assert.ok(rows.some(row => row.id === record.id), 'created record can be read');

    r = await request('/api/records/students/' + record.id, { method: 'DELETE' });
    assert.equal(r.status, 200, 'record deletion succeeds');

    r = await request('/api/password', {
      method: 'POST',
      body: JSON.stringify({ password: 'CI-new-password-12345' })
    });
    assert.equal(r.status, 200, 'password can be changed');
    r = await request('/api/me');
    assert.equal(r.status, 401, 'password change revokes old session');

    cookie = '';
    r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'CI-new-password-12345' })
    });
    assert.equal(r.status, 200, 'new password works');

    console.log('Integration checks passed');
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
