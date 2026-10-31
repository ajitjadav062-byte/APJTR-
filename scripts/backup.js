'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function main() {
  const dataDir = await fsp.realpath(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  if (!process.env.BACKUP_DIR) throw new Error('Set BACKUP_DIR to a directory outside DATA_DIR');
  await fsp.mkdir(process.env.BACKUP_DIR, { recursive: true, mode: 0o700 });
  const backupRoot = await fsp.realpath(process.env.BACKUP_DIR);
  if (inside(dataDir, backupRoot) || inside(backupRoot, dataDir)) {
    throw new Error('BACKUP_DIR and DATA_DIR must be separate, non-nested directories');
  }

  const sourceDb = path.join(dataDir, 'apjtr.db');
  const uploadRoot = await fsp.realpath(path.join(dataDir, 'uploads'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalDir = path.join(backupRoot, 'APJ-TR-' + stamp + '-' + crypto.randomBytes(3).toString('hex'));
  const stageDir = finalDir + '.partial';
  await fsp.mkdir(stageDir, { mode: 0o700 });
  let db;
  try {
    db = new DatabaseSync(sourceDb, { readOnly: true });
    const rows = db.prepare('SELECT id,name,type,path,size,created_at FROM files ORDER BY id').all();
    await backup(db, path.join(stageDir, 'apjtr.db'));
    db.close();
    db = null;

    const copiedFiles = [];
    for (const row of rows) {
      const source = path.resolve(row.path);
      if (!inside(uploadRoot, source) || source === uploadRoot) {
        throw new Error('A stored upload path is outside the uploads directory (file id ' + row.id + ')');
      }
      const stat = await fsp.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('An upload is not a regular file (file id ' + row.id + ')');
      }
      if (stat.size !== row.size) throw new Error('Upload size mismatch (file id ' + row.id + ')');
      const relativePath = path.join('uploads', String(row.id) + '-' + path.basename(source));
      const destination = path.join(stageDir, relativePath);
      await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      const digest = await sha256(destination);
      if (digest !== await sha256(source)) throw new Error('Upload checksum mismatch (file id ' + row.id + ')');
      await fsp.chmod(destination, 0o600);
      copiedFiles.push({
        id: row.id,
        name: row.name,
        type: row.type,
        size: stat.size,
        created_at: row.created_at,
        backup_path: relativePath.split(path.sep).join('/'),
        sha256: digest
      });
    }

    const databasePath = path.join(stageDir, 'apjtr.db');
    const checkDb = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const integrity = checkDb.prepare('PRAGMA integrity_check').get();
      if (!integrity || integrity.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    } finally {
      checkDb.close();
    }
    const manifest = {
      format: 'apj-tr-backup-v1',
      created_at: new Date().toISOString(),
      database: { path: 'apjtr.db', size: (await fsp.stat(databasePath)).size, sha256: await sha256(databasePath) },
      files: copiedFiles
    };
    const manifestPath = path.join(stageDir, 'manifest.json');
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fsp.rename(stageDir, finalDir);
    console.log(JSON.stringify({ ok: true, backup_directory: finalDir, file_count: copiedFiles.length, database_sha256: manifest.database.sha256 }));
  } catch (error) {
    if (db) db.close();
    await fsp.rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}
main().catch(error => {
  console.error('Backup failed:', error.message);
  process.exitCode = 1;
});
