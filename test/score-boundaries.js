const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apjtr-score-boundary-'));
  const port = 43000 + Math.floor(Math.random() * 10000);
  const password = 'CI-score-test-password-123';
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
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, { ...options, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  }
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'test server starts');
    let r = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password })
    });
    assert.equal(r.status, 200, 'admin login succeeds');

    const invalidCases = [
      { score: -1, total: 100, label: 'negative score is rejected' },
      { score: 0, total: 0, label: 'zero total is rejected' },
      { score: 'not-a-number', total: 100, label: 'malformed score is rejected' },
      { score: 50, total: 'not-a-number', label: 'malformed total is rejected' }
    ];
    for (const item of invalidCases) {
      r = await request('/api/records/results', {
        method: 'POST',
        body: JSON.stringify({ student: 'Synthetic boundary test', score: item.score, total: item.total })
      });
      assert.equal(r.status, 400, item.label);
    }
    r = await request('/api/records/results', {
      method: 'POST',
      body: JSON.stringify({ student: 'Synthetic boundary test', score: 0, total: 100 })
    });
    assert.equal(r.status, 201, 'zero score with positive total is accepted');
    const saved = await r.json();
    r = await request('/api/records/results/' + saved.id, { method: 'DELETE' });
    assert.equal(r.status, 200, 'valid boundary test record is removed');
    console.log('Score boundary tests passed');
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
