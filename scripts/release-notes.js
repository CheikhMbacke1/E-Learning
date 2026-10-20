// Extrait la section "## [X.Y.Z]" du CHANGELOG.md pour la release GitHub.
const fs = require('fs');
const v = (process.argv[2] || '').replace(/^v/, '');
const text = fs.readFileSync(require('path').join(__dirname, '../CHANGELOG.md'), 'utf8');
const m = new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm').exec(text);
if (!m) { console.error(`Aucune section [${v}] dans CHANGELOG.md`); process.exit(1); }
process.stdout.write(m[1].trim() + '\n');
