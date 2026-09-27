require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10
});
const allowed = (process.env.CORS_ORIGIN || '*').split(',').map(x => x.trim());
app.use(helmet());
app.use(cors({ origin: allowed.includes('*') ? true : allowed }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files are allowed'), ok);
  }
});

const clean = v => v === undefined || v === null ? '' : String(v).trim();
const pick = (r, names) => {
  const normalised = Object.fromEntries(Object.entries(r).map(([k,v]) => [clean(k).toLowerCase().replace(/[ _-]/g,''), v]));
  for (const n of names) if (normalised[n]) return clean(normalised[n]);
  return '';
};
function mapRow(row, rowNumber) {
  const data = {
    gr_no: pick(row, ['grno','grnumber','rollno','studentid']),
    full_name: pick(row, ['fullname','name','studentname']),
    standard: pick(row, ['standard','std','class']),
    division: pick(row, ['division','div','section']) || null,
    mobile: pick(row, ['mobile','phone','mobileno','parentmobile']) || null,
    parent_name: pick(row, ['parentname','guardianname','fathername','mothername']) || null,
    address: pick(row, ['address']) || null
  };
  const errors = [];
  if (!data.gr_no) errors.push('GR No is required');
  if (!data.full_name) errors.push('Full Name is required');
  if (!data.standard) errors.push('Standard is required');
  if (data.mobile && !/^[0-9+() -]{7,20}$/.test(data.mobile)) errors.push('Invalid mobile');
  return { row: rowNumber, data, errors };
}

app.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'APJ TR API' });
});
app.get('/api/students', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const result = await pool.query('SELECT * FROM students ORDER BY id DESC LIMIT $1', [limit]);
  res.json(result.rows);
});

app.post('/api/students/bulk-upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Upload field must be named file' });
  let workbook;
  try { workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true }); }
  catch { return res.status(400).json({ error: 'Excel file could not be read' }); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) return res.status(400).json({ error: 'The first sheet has no data rows' });
  if (rows.length > 5000) return res.status(413).json({ error: 'Maximum 5000 rows per upload' });

  const parsed = rows.map((r, i) => mapRow(r, i + 2));
  const invalid = parsed.filter(x => x.errors.length);
  if (invalid.length && req.query.partial !== 'true') {
    return res.status(422).json({ error: 'Validation failed; nothing imported', invalidRows: invalid.slice(0, 100), invalidCount: invalid.length });
  }

  const valid = parsed.filter(x => !x.errors.length);
  const client = await pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (const { data } of valid) {
      const q = await client.query(`
        INSERT INTO students (gr_no, full_name, standard, division, mobile, parent_name, address)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (gr_no) DO UPDATE SET
          full_name=EXCLUDED.full_name, standard=EXCLUDED.standard,
          division=EXCLUDED.division, mobile=EXCLUDED.mobile,
          parent_name=EXCLUDED.parent_name, address=EXCLUDED.address, updated_at=NOW()
        RETURNING (xmax = 0) AS inserted`,
        [data.gr_no, data.full_name, data.standard, data.division, data.mobile, data.parent_name, data.address]);
      q.rows[0].inserted ? inserted++ : updated++;
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Bulk upload completed', totalRows: rows.length, imported: valid.length, inserted, updated, invalidCount: invalid.length, invalidRows: invalid.slice(0, 100) });
  } catch (e) {
    await client.query('ROLLBACK'); next(e);
  } finally { client.release(); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: err.message || 'Internal server error' });
});
const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => console.log(`APJ TR API listening on ${port}`));
