'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { mkdtemp, readFile, readdir, rm, cp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { verify } = require('../scripts/verify-backup');

(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apjtr-backup-test-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const port = 44000 + Math.floor(Math.random() * 10000);
  const password = 'CI-backup-password-12345';
  let child;
  const base = 'http://127.0.0.1:' + port;
  try {
    const start = () => {
      child = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, ADMIN_PASSWORD: password, DATA_DIR: dataDir, PORT: String(port) },
        stdio: 'ignore'
      });
    };
    start();
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(base + '/')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'test server starts');
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const recordResponse = await fetch(base + '/api/records/students', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Backup Fixture', class: '7', parent: 'Synthetic', status: 'નિયમિત' })
    });
    assert.equal(recordResponse.status, 201);
    const bytes = Buffer.from('%PDF-1.7\\nAPJ-TR backup fixture');
    const uploadResponse = await fetch(base + '/api/files', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'backup-fixture.pdf', type: 'application/pdf', data: bytes.toString('base64') })
    });
    assert.equal(uploadResponse.status, 201);

    const run = spawn(process.execPath, ['scripts/backup.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: backupDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    run.stderr.on('data', chunk => stderr += chunk);
    const exitCode = await new Promise((resolve, reject) => {
      run.once('error', reject);
      run.once('close', resolve);
    });
    assert.equal(exitCode, 0, 'backup command succeeds: ' + stderr);
    const backupFolders = await readdir(backupDir);
    assert.equal(backupFolders.length, 1);
    const folder = path.join(backupDir, backupFolders[0]);
    const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'apj-tr-backup-v1');
    assert.equal(manifest.files.length, 1);
    const backedUpBytes = await readFile(path.join(folder, manifest.files[0].backup_path));
    assert.deepEqual(backedUpBytes, bytes, 'backup contains original upload bytes');
    assert.equal(crypto.createHash('sha256').update(backedUpBytes).digest('hex'), manifest.files[0].sha256);
    const database = new DatabaseSync(path.join(folder, 'apjtr.db'), { readOnly: true });
    try {
      assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM records WHERE type='students'").get().count, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM files').get().count, 1);
    } finally { database.close(); }

    const valid = await verify(folder);
    assert.equal(valid.ok, true, 'valid backup verifies');
    assert.equal(valid.file_count, 1);

    const tampered = path.join(root, 'tampered');
    await cp(folder, tampered, { recursive: true });
    await writeFile(path.join(tampered, manifest.files[0].backup_path), 'tampered');
    await assert.rejects(() => verify(tampered), /size mismatch|checksum mismatch/, 'modified upload is rejected');

    const traversal = path.join(root, 'traversal');
    await cp(folder, traversal, { recursive: true });
    const traversalManifest = JSON.parse(await readFile(path.join(traversal, 'manifest.json'), 'utf8'));
    traversalManifest.files[0].backup_path = '../outside.pdf';
    await writeFile(path.join(traversal, 'manifest.json'), JSON.stringify(traversalManifest));
    await assert.rejects(() => verify(traversal), /Invalid backup file path|escapes backup directory/, 'path traversal is rejected');

    const nestedBackup = spawnSync(process.execPath, ['scripts/backup.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'nested-backups') },
      encoding: 'utf8'
    });
    assert.notEqual(nestedBackup.status, 0, 'backup inside DATA_DIR is rejected');
    assert.match(nestedBackup.stderr, /must be separate/);
    console.log('Backup snapshot, checksum, verification and path safety tests passed');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
