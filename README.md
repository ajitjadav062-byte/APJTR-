# APJ TR Online

Database-backed Gujarati school web app using Node.js and SQLite.

## Local setup
- Requires Node.js 24 or newer.
- Set `ADMIN_PASSWORD` to a strong password of at least 12 characters before the first start.
- Run `npm start`, then open `http://localhost:3000`.
- The first startup creates the `admin` account using `ADMIN_PASSWORD`. Existing databases keep their existing admin password.

## Render deployment
1. Create a Blueprint from this repository using `render.yaml`.
2. Keep the generated `ADMIN_PASSWORD` secret in Render environment settings; never commit it.
3. Keep the persistent disk mounted at `/var/data` for the SQLite database and uploads.
4. Restrict the app to authorised school staff and verify backups before storing real student information.

The web server serves only the checked-in `index.html`, `style.css`, and `app.js` files. Login attempts are temporarily rate-limited after repeated failures.

## Safe offline backup

- Set `DATA_DIR` to the live app data directory and `BACKUP_DIR` to a separate, protected directory outside it.
- Run `BACKUP_DIR=/secure/backup/location npm run backup` (keep the path private and access-controlled).
- The command creates a new backup folder containing a SQLite online-backup snapshot, copies of uploaded files, and a SHA-256 manifest.
- It checks SQLite integrity and verifies copied upload checksums. If any source upload is missing or invalid, the backup is marked failed and the partial folder is removed.
- Keep backups off the app's public web directory and outside the persistent app data directory. Protect backup storage with restricted access and encryption at rest.
- This is a backup-only operation. It does not restore data, change the live database, or expose a web backup endpoint. Restore remains disabled and must be separately designed and tested.
