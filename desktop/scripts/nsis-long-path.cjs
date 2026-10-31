const fs = require('node:fs/promises');
const path = require('node:path');

// Build-only extraction adapter, following deepseek-ai/deepseek-harness:
// apps/desktop/scripts/windows-directory-installer.mjs.
// Retain upstream uninstall, registration, shortcuts and installer UI.
module.exports = async ({ electronPlatformName, appOutDir }) => {
  if (electronPlatformName !== 'win32') return;
  require('app-builder-lib');
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
  const sourceTool = await getPath7za();
  const licenses = path.dirname(path.dirname(sourceTool));
  await fs.copyFile(path.join(licenses, 'LICENSE.txt'), path.join(appOutDir, 'resources/LICENSE.7zip.txt'));
  await fs.copyFile(path.join(licenses, 'COPYING'), path.join(appOutDir, 'resources/COPYING.7zip.txt'));
  const prototype = NsisTarget.prototype;
  const installed = Symbol.for('blinkflow.nsis.long-path');
  if (prototype[installed]) return;
  prototype[installed] = true;
  const original = prototype.computeFinalScript;
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const replaceOnce = (source, before, after) => {
    if (source.split(before).length !== 2) throw new Error('NSIS template changed: ' + before);
    return source.replace(before, () => after);
  };
  const quote = value => value.replaceAll('$', () => '$$');
  prototype.computeFinalScript = async function (source, isInstaller, ...args) {
    if (!isInstaller || this.name !== 'nsis') return original.call(this, source, isInstaller, ...args);
    const directory = path.join(this.outDir, '.nsis-long-path');
    await fs.mkdir(directory, { recursive: true });
    const section = path.join(directory, 'installSection.nsh');
    const upstream = (await fs.readFile(path.join(templates, 'installSection.nsh'), 'utf8')).replaceAll('\r\n', '\n');
    const override = [
      '!include installer.nsh',
      '!macroundef extractUsing7za',
      '!macro extractUsing7za FILE',
      '  !insertmacro blinkflowExtractPayload "${FILE}"',
      '!macroend',
    ].join('\n');
    await fs.writeFile(section, replaceOnce(upstream, '!include installer.nsh', override));
    const tool = path.join(directory, '7za.exe');
    await fs.copyFile(sourceTool, tool);
    const adapted = replaceOnce(source, '!include "installSection.nsh"', '!include "' + quote(section) + '"');
    return '!define BLINKFLOW_7ZIP_PATH "' + quote(tool) + '"\n'
      + await original.call(this, adapted, isInstaller, ...args);
  };
};
