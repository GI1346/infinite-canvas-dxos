// Run with the project's Electron binary; no window or installer is started.
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const testDirectory = path.join(root, '.checks/icon-test-0209'); fs.mkdirSync(testDirectory, { recursive: true });
app.setPath('appData', testDirectory); app.setPath('userData', path.join(testDirectory, 'Profile')); app.setPath('temp', path.join(root, '.checks/temp'));
const pngBytes = fs.readFileSync(path.join(root, 'web/public/blinkflow.png'));
assert.deepEqual(fs.readFileSync(path.join(root, 'desktop/assets/blinkflow.png')), pngBytes, 'web and desktop brand PNG must be identical');
const png = nativeImage.createFromBuffer(pngBytes), { width, height } = png.getSize(); assert(width > 0 && width === height, 'square brand PNG');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/public/manifest.webmanifest'), 'utf8'));
assert(manifest.icons.some(icon => icon.src === '/blinkflow.png' && icon.sizes === `${width}x${height}`), 'manifest must describe the actual PNG');
function verifyAlpha(image) {
    const size = image.getSize(), pixels = image.toBitmap();
    for (const index of [0, size.width - 1, size.width * (size.height - 1), size.width * size.height - 1]) assert.equal(pixels[index * 4 + 3], 0, 'exterior corners must remain transparent');
    let visible = 0; for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 0) visible++;
    assert(visible > 0, 'the artwork must remain visible'); return { ...size, visiblePixels: visible, transparentCorners: true };
}
const pngResult = verifyAlpha(png), icoBytes = fs.readFileSync(path.join(root, 'desktop/assets/blinkflow.ico'));
assert.equal(icoBytes.readUInt16LE(0), 0); assert.equal(icoBytes.readUInt16LE(2), 1); assert.equal(icoBytes.readUInt16LE(4), 7);
const sizes = [16, 24, 32, 48, 64, 128, 256], frames = [];
for (let index = 0; index < sizes.length; index++) {
    const size = sizes[index], entry = 6 + index * 16, offset = icoBytes.readUInt32LE(entry + 12), length = icoBytes.readUInt32LE(entry + 8);
    assert(offset >= 118 && offset + length <= icoBytes.length, 'valid ICO frame bounds');
    const image = nativeImage.createFromBuffer(icoBytes.subarray(offset, offset + length)); assert.deepEqual(image.getSize(), { width: size, height: size });
    // Compare actual decoded pixels with nativeImage's resize of the current PNG, not just frame metadata.
    assert.deepEqual(image.toBitmap(), png.resize({ width: size, height: size, quality: 'best' }).toBitmap(), `ICO frame ${size} does not use the current brand PNG`);
    frames.push(verifyAlpha(image));
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const result = { passed: true, completedAt: new Date().toISOString(), png: pngResult, frames, pngSHA256: hash(pngBytes), icoSHA256: hash(icoBytes), startedGui: false, executedInstaller: false };
fs.writeFileSync(path.join(root, '.checks/brand-icon-0209-test.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); app.exit(0);
