const { buildSync } = require('esbuild');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const outfile = '.checks/desktop-storage-ui.cjs';
buildSync({ entryPoints: ['tests/desktop-storage-ui.check.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile });
execFileSync(process.execPath, ['--require', path.resolve('tests/channel-protocol-dom.cjs'), outfile], { stdio: 'inherit' });
