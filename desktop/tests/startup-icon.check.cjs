// Real Electron acceptance against an isolated copy of the production main process.
const { app, BrowserWindow, nativeImage, screen, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const phase = process.argv.find(value => ['initial', 'reopen'].includes(value)) || 'initial';
app.disableHardwareAcceleration();
assert(['initial', 'reopen'].includes(phase));
const fixture = path.join(root, '.checks/startup-icon-0208');
fs.mkdirSync(path.join(fixture, 'web'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'mock-appdata'), { recursive: true });
app.setPath('appData', path.join(fixture, 'mock-appdata'));
for (const name of ['main.cjs', 'preload.cjs', 'storage.cjs', 'storage-renderer.cjs']) fs.copyFileSync(path.join(root, 'desktop', name), path.join(fixture, name));
fs.copyFileSync(path.join(root, 'desktop/assets/blinkflow.ico'), path.join(fixture, 'assets/blinkflow.ico'));
fs.writeFileSync(path.join(fixture, 'web/index.html'), '<!doctype html><title>BlinkFlow isolated startup acceptance</title><p>Maximized startup and transparent icon acceptance</p>');
dialog.showErrorBox = (title, message) => { console.error(title + ': ' + message); app.exit(1); };
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => setTimeout(() => {
    try {
      assert.equal(win.isMaximized(), true, 'every launch must maximize');
      assert.equal(win.isVisible(), true, 'loaded window must be visible');
      const bounds = win.getBounds(), workArea = screen.getDisplayMatching(bounds).workArea;
      assert(bounds.width >= workArea.width && bounds.height >= workArea.height, 'maximized window covers its display work area');
      assert.equal(app.getPath('userData'), path.join(fixture, 'BlinkFlowData/Profile'));
      const png = nativeImage.createFromPath(path.join(root, 'web/public/blinkflow.png'));
      const size = png.getSize(), pixels = png.toBitmap();
      assert(size.width > 0 && size.width === size.height, 'brand PNG must remain a square image');
      for (const index of [0, size.width - 1, size.width * (size.height - 1), size.width * size.height - 1]) assert.equal(pixels[index * 4 + 3], 0, 'PNG exterior corners transparent');
      assert(pixels.some((value, index) => index % 4 === 3 && value > 0), 'artwork must remain visible; source alpha is preserved');
      const ico = fs.readFileSync(path.join(root, 'desktop/assets/blinkflow.ico'));
      assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 7);
      const sizes = [];
      for (let index = 0; index < 7; index++) {
        const entry = 6 + index * 16, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
        const frame = nativeImage.createFromBuffer(ico.subarray(offset, offset + length));
        const bitmap = frame.toBitmap(), dimensions = frame.getSize(); sizes.push(dimensions.width);
        for (const pixel of [0, dimensions.width - 1, dimensions.width * (dimensions.height - 1), dimensions.width * dimensions.height - 1]) assert.equal(bitmap[pixel * 4 + 3], 0, 'ICO exterior corners transparent');
        assert.equal(dimensions.width, dimensions.height);
      }
      assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
      // Leave a deliberately non-maximized state before closing; the next launch must ignore it.
      win.unmaximize(); win.setSize(1000, 700);
      const result = { phase, maximizedAtStartup: true, visible: true, bounds, workArea, iconSizes: sizes, pngCornersTransparent: true, icoCornersTransparent: true, finalManualSize: win.getSize(), isolatedDataDirectory: path.join(fixture, 'BlinkFlowData') };
      fs.writeFileSync(path.join(root, `.checks/startup-icon-0208-${phase}.json`), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result)); win.destroy(); app.quit();
    } catch (error) { console.error(error.stack); BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(1); }
  }, 300));
});
require(path.join(fixture, 'main.cjs'));