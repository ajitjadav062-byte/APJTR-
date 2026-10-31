import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(source, /function csvCell\(v\)/, 'CSV cell sanitizer must exist');
assert.match(source, /if\(\/\^\\s\*\[=\+\\-@\]\/\.test\(s\)\)/, 'formula-leading characters after optional whitespace must be neutralized');
assert.match(source, /s\.replace\(\/"\/g, '\"\"'\)/, 'CSV quotes must be escaped');
assert.match(source, /\.map\(csvCell\)\.join\(','\)/, 'every exported CSV cell must pass through the sanitizer');
assert.doesNotMatch(source, /\[r\.student,r\.subject,r\.score,r\.total\]\.join\(','\)/, 'raw CSV cell concatenation must not return');
console.log('CSV export security checks passed');
