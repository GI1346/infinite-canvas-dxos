const path = require('node:path');
const { buildSync } = require('esbuild');
const { execFileSync } = require('node:child_process');
process.chdir(path.resolve(__dirname, '..'));
const outfile = '.checks/image-preview.cjs';
buildSync({ entryPoints: ['tests/image-preview.check.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile });
execFileSync(process.execPath, ['--require', path.resolve('tests/image-tools-dom.cjs'), outfile], { stdio: 'inherit' });
