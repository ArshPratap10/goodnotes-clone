const { Jimp } = require('jimp');
const { imagesToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

async function convert() {
  const img = await Jimp.read(path.join(__dirname, 'electron', 'icon.jpg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await img.clone().resize({ w: size, h: size }).getBuffer('image/png');
    pngBuffers.push(buf);
  }
  const icoBuffer = await imagesToIco(pngBuffers);
  fs.writeFileSync(path.join(__dirname, 'electron', 'icon.ico'), icoBuffer);
  console.log('ICO created!');
}
convert().catch(console.error);
