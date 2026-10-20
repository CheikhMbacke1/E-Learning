// Vérifie que le tag Git (vX.Y.Z) correspond à la version du package.json racine et de l'API.
const tag = (process.argv[2] || '').replace(/^v/, '');
const root = require('../package.json').version;
const api = require('../apps/api/package.json').version;
if (!tag) { console.error('Usage : node scripts/check-version.js vX.Y.Z'); process.exit(1); }
if (tag !== root || tag !== api) {
  console.error(`Incohérence : tag=${tag}, package.json racine=${root}, apps/api=${api}`);
  process.exit(1);
}
console.log(`Version ${tag} cohérente.`);
