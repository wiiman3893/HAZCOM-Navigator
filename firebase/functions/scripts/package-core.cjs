const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../../packages/core');
const destination = path.resolve(__dirname, '../vendor/core');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));

if (!fs.existsSync(path.join(source, 'dist/index.js'))) {
  throw new Error('Build @hazcom/core before packaging Firebase Functions.');
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  private: true,
  type: manifest.type,
  main: manifest.main,
  exports: manifest.exports,
}, null, 2) + '\n');
fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
