CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  gr_no VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  standard VARCHAR(20) NOT NULL,
  division VARCHAR(10),
  mobile VARCHAR(20),
  parent_name VARCHAR(150),
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS students_standard_division_idx ON students(standard, division);
