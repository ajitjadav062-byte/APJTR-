'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function safeRegularFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) {
    throw new Error('Invalid backup file path');
  }
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid backup file path');
  const target = path.resolve(root, ...parts);
  if (!inside(root, target) || target === root) throw new Error('Backup file path escapes backup directory');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Backup path contains a symbolic link');
    if (current !== target && !stat.isDirectory()) throw new Error('Backup path parent is not a directory');
    if (current === target && !stat.isFile()) throw new Error('Backup item is not a regular file');
  }
  return target;
}

async function verify(directory) {
  const root = await fsp.realpath(directory);
  const rootStat = await fsp.lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Backup location must be a real directory');

  const manifestPath = await safeRegularFile(root, 'manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (!manifest || manifest.format !== 'apj-tr-backup-v1' || !Array.isArray(manifest.files) || !manifest.database) {
    throw new Error('Unsupported or invalid backup manifest');
  }
  if (manifest.database.path !== 'apjtr.db') throw new Error('Unexpected database path');
  const databasePath = await safeRegularFile(root, manifest.database.path);
  const dbStat = await fsp.stat(databasePath);
  if (!Number.isSafeInteger(manifest.database.size) || dbStat.size !== manifest.database.size) {
    throw new Error('Database size mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.database.sha256 || '') || await sha256(databasePath) !== manifest.database.sha256) {
    throw new Error('Database checksum mismatch');
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (!integrity || integrity.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    const rows = db.prepare('SELECT id,name,type,size,created_at FROM files ORDER BY id').all();
    if (rows.length !== manifest.files.length) throw new Error('Manifest file count does not match database');
    const byId = new Map(rows.map(row => [String(row.id), row]));
    const seen = new Set();
    for (const item of manifest.files) {
      if (!item || !Number.isSafeInteger(item.id) || seen.has(String(item.id))) throw new Error('Invalid or duplicate manifest file id');
      seen.add(String(item.id));
      const row = byId.get(String(item.id));
      if (!row || row.name !== item.name || row.type !== item.type || row.size !== item.size || row.created_at !== item.created_at) {
        throw new Error('Manifest metadata does not match database (file id ' + item.id + ')');
      }
      const filePath = await safeRegularFile(root, item.backup_path);
      const stat = await fsp.stat(filePath);
      if (stat.size !== item.size) throw new Error('Upload size mismatch (file id ' + item.id + ')');
      if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') || await sha256(filePath) !== item.sha256) {
        throw new Error('Upload checksum mismatch (file id ' + item.id + ')');
      }
    }
  } finally {
    db.close();
  }
  return { ok: true, file_count: manifest.files.length, database_sha256: manifest.database.sha256 };
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: node scripts/verify-backup.js <backup-directory>');
    process.exitCode = 2;
  } else {
    verify(directory)
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => {
        console.error('Backup verification failed:', error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { verify };
