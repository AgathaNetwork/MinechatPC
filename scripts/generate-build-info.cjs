const fs = require('fs');
const path = require('path');

function main() {
  const outPath = path.join(__dirname, '..', 'src', 'build-info.json');
  const now = new Date();

  const info = {
    buildTimeIso: now.toISOString(),
    buildTimeMs: now.getTime(),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n', 'utf8');
  process.stdout.write(`Generated ${outPath}\n`);
}

main();
