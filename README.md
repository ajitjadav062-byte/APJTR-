# APJ TR PostgreSQL Excel Bulk Upload API

## API
`POST /api/students/bulk-upload` with multipart field `file`.
Accepted: `.xlsx`, `.xls`, `.csv`; max 5 MB and 5000 data rows.
Required columns: `GR No`, `Full Name`, `Standard`.
Optional: `Division`, `Mobile`, `Parent Name`, `Address`.
Existing `GR No` is updated; new `GR No` is inserted. Default is all-or-nothing validation. Add `?partial=true` to skip invalid rows.

## Local
1. Create PostgreSQL database `apjtr`.
2. Copy `.env.example` to `.env` and edit `DATABASE_URL`.
3. `npm install`
4. `npm run db:init`
5. `npm start`
6. Open `http://localhost:10000`.

## Render
1. Push this folder to GitHub.
2. In Render, create a Blueprint from `render.yaml`.
3. After services are created, open the Web Service Shell and run `npm run db:init` once.
4. Open the generated `onrender.com` URL.
5. Set `CORS_ORIGIN` to the exact frontend URL before production use.

## curl test
```bash
curl -X POST -F "file=@student-template.csv" https://YOUR-SERVICE.onrender.com/api/students/bulk-upload
```
