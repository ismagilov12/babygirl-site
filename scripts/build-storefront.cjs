// Keep EN synchronized after every existing catalog build/maintenance step.
const {spawnSync} = require('node:child_process');
for (const script of ['scripts/build-catalog.cjs', 'scripts/sync-en-catalog.cjs', 'scripts/sync-en-catalog.test.cjs']) {
  const result = spawnSync(process.execPath, [script], {stdio:'inherit',env:process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
