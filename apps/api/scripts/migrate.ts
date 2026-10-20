import { migrate } from '../src/db/migrator';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant'); process.exit(1); }
migrate(url).then((a) => {
  console.log(a.length ? `Migrations appliquées : ${a.join(', ')}` : 'Base déjà à jour.');
}).catch((e) => { console.error(e.message); process.exit(1); });
