const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const icnsPath = path.join(buildDir, 'icon.icns');
const iconsetDir = path.join(buildDir, 'icon.iconset');

(async () => {
  const svg = fs.readFileSync(svgPath);

  // 1. 기본 PNG 아이콘 생성 (512x512)
  await sharp(svg, { density: 768 }).resize(512, 512).png().toFile(pngPath);
  console.log('PNG 생성 완료:', pngPath);

  // 2. macOS용 .icns 파일 생성
  try {
    if (!fs.existsSync(iconsetDir)) {
      fs.mkdirSync(iconsetDir, { recursive: true });
    }

    const sizes = [
      { name: 'icon_16x16.png', size: 16 },
      { name: 'icon_16x16@2x.png', size: 32 },
      { name: 'icon_32x32.png', size: 32 },
      { name: 'icon_32x32@2x.png', size: 64 },
      { name: 'icon_128x128.png', size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png', size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png', size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ];

    for (const item of sizes) {
      await sharp(svg, { density: 768 })
        .resize(item.size, item.size)
        .png()
        .toFile(path.join(iconsetDir, item.name));
    }

    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    console.log('ICNS 생성 완료:', icnsPath);

    fs.rmSync(iconsetDir, { recursive: true, force: true });
  } catch (err) {
    console.warn('ICNS 생성 중 오류 (macOS iconutil 필요):', err.message);
  }
})();

