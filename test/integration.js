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

    const samples = [
      ['sample.pdf', 'application/pdf', Buffer.from('%PDF-1.7\\n')],
      ['sample.jpg', 'image/jpeg', Buffer.from([255,216,255,217])],
      ['sample.png', 'image/png', Buffer.from([137,80,78,71,13,10,26,10])],
      ['sample.doc', 'application/msword', Buffer.from([208,207,17,224,161,177,26,225])],
      ['sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from([80,75,3,4,0,0])],
      ['sample.mp4', 'video/mp4', Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109])],
      ['sample.mp3', 'audio/mpeg', Buffer.from('ID3sample')],
      ['sample.wav', 'audio/wav', Buffer.from('RIFFxxxxWAVEdata')]
    ];
    for (const [name, type, bytes] of samples) {
      r = await request('/api/files', {
        method: 'POST',
        body: JSON.stringify({ name, type, data: bytes.toString('base64') })
      });
      assert.equal(r.status, 201, name + ' signature upload succeeds');
      const file = await r.json();
      r = await request('/api/files/' + file.id);
      assert.equal(r.status, 200, name + ' download succeeds');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes, name + ' bytes are preserved');
      r = await request('/api/files/' + file.id, { method: 'DELETE' });
      assert.equal(r.status, 200, name + ' delete succeeds');
    }

    r = await request('/api/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'fake.pdf', type: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') })
    });
    assert.equal(r.status, 400, 'mismatched file signature is rejected');

    r = await request('/api/files/' + uploaded.id, { method: 'DELETE' });
    assert.equal(r.status, 200, 'file deletion succeeds');

    r = await request('/api/records/results', {
      method: 'POST',
      body: JSON.stringify({ student: 'Synthetic CI Student', subject: 'Math', score: 101, total: 100 })
    });
    assert.equal(r.status, 400, 'score above total is rejected');

    r = await request('/api/records/results', {
      method: 'POST',
      body: JSON.stringify({ student: 'Synthetic CI Student', subject: 'Math', score: 75, total: 100 })
    });
    assert.equal(r.status, 201, 'valid score is accepted');
    const result = await r.json();
    assert.equal(result.score, 75);
    assert.equal(result.total, 100);
    r = await request('/api/records/results/' + result.id, { method: 'DELETE' });
    assert.equal(r.status, 200, 'test result can be deleted');

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
