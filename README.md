# APJ TR Online

Database-backed Gujarati school web app. Uses Node.js and SQLite.

## Local
Requires Node.js 24+. Run `npm start`, then open `http://localhost:3000`.
Default login: `admin` / `APJ@123`. Set `ADMIN_PASSWORD` before first start.

## Render deployment
1. Upload this folder to a GitHub repository.
2. In Render, create a Blueprint from the repository using `render.yaml`.
3. After deployment, open the generated URL.
4. Use a paid persistent disk. SQLite and uploaded files are written to `/var/data`.

For production, change the default password immediately and restrict access to authorised school staff.
