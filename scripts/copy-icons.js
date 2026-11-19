const fs = require('fs'), path = require('path');
for (const d of ['nodes/Asin402', 'nodes/Geo402', 'credentials']) {
  for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.svg'))) {
    fs.mkdirSync(path.join('dist', d), { recursive: true });
    fs.copyFileSync(path.join(d, f), path.join('dist', d, f));
  }
}
