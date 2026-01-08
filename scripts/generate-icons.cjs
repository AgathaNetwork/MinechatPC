const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = path.join(root, 'assets', 'icon.ico');

async function main() {
  if (!fs.existsSync(pngPath)) {
    console.log('[icon] Skip: missing assets/icon.png');
    return;
  }

  // Lazy-require so install doesn't fail when file is missing.
  const pngToIco = require('png-to-ico');

  const icoBuf = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, icoBuf);
  console.log('[icon] Generated:', path.relative(root, icoPath));
}

main().catch((err) => {
  // Do not fail installation/build pipeline just because icon generation failed.
  console.warn('[icon] Failed to generate .ico:', err && err.message ? err.message : err);
  process.exit(0);
});
