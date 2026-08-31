const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
const pngPath = path.join(__dirname, '..', 'build', 'icon.png');

(async () => {
  const svg = fs.readFileSync(svgPath);
  // mac(.icns)/win(.ico)/linux 자동 생성을 위해 512x512 이상 필요 (electron-builder가 변환).
  await sharp(svg, { density: 768 }).resize(512, 512).png().toFile(pngPath);
  console.log('생성 완료:', pngPath);
})();
