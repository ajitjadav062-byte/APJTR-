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
