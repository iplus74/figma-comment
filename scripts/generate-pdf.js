// scripts/generate-pdf.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');

app.whenReady().then(async () => {
  const rootDir = '/Users/yangsukim/data/work/house_sara/figma-comment';
  const mdPath = path.join(rootDir, 'USER_GUIDE.md');
  const pdfPath = path.join(rootDir, 'USER_GUIDE.pdf');
  const tempHtmlPath = path.join(rootDir, 'temp_guide_print.html');

  let mdContent = fs.readFileSync(mdPath, 'utf8');

  // 이미지 경로를 file:// 절대 경로로 변환하여 브라우저에서 확실히 로드되도록 함
  mdContent = mdContent.replace(/\.\/docs\/images\//g, `${path.join(rootDir, 'docs/images')}/`);

  const htmlBody = marked.parse(mdContent, { gfm: true, breaks: true });

  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>FigCommi 사용자 가이드</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 15mm 18mm 15mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13.5px;
      line-height: 1.65;
      color: #24292f;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-size: 26px;
      border-bottom: 2px solid #eaecef;
      padding-bottom: 8px;
      margin-top: 0;
      margin-bottom: 16px;
      color: #1a1f2c;
    }
    h2 {
      font-size: 19px;
      border-bottom: 1px solid #eaecef;
      padding-bottom: 6px;
      margin-top: 24px;
      margin-bottom: 12px;
      color: #2d3748;
      page-break-after: avoid;
    }
    h3 {
      font-size: 15.5px;
      margin-top: 18px;
      margin-bottom: 10px;
      color: #3b4252;
      page-break-after: avoid;
    }
    h4 {
      font-size: 14px;
      margin-top: 14px;
      margin-bottom: 8px;
      color: #4c566a;
      page-break-after: avoid;
    }
    p, ul, ol {
      margin-top: 0;
      margin-bottom: 12px;
    }
    li {
      margin-bottom: 5px;
    }
    hr {
      height: 1px;
      background-color: #e1e4e8;
      border: none;
      margin: 24px 0;
    }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 12px;
      background-color: #f6f8fa;
      padding: 2px 5px;
      border-radius: 4px;
      border: 1px solid #e1e4e8;
    }
    pre {
      background-color: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.45;
      page-break-inside: avoid;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      border: none;
      border-radius: 0;
    }
    blockquote {
      margin: 12px 0;
      padding: 6px 14px;
      color: #57606a;
      border-left: 4px solid #d0d7de;
      background-color: #f8f9fa;
      page-break-inside: avoid;
    }
    img {
      max-width: 95%;
      height: auto;
      display: block;
      margin: 14px auto;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
      page-break-inside: avoid;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #d0d7de;
      padding: 6px 12px;
      font-size: 13px;
    }
    th {
      background-color: #f6f8fa;
      font-weight: 600;
    }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;

  fs.writeFileSync(tempHtmlPath, fullHtml, 'utf8');

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      offscreen: true,
    },
  });

  await win.loadFile(tempHtmlPath);

  // 모든 이미지가 로드될 때까지 충분히 대기
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const imgs = Array.from(document.images);
      if (imgs.length === 0) return resolve();
      let loaded = 0;
      imgs.forEach(img => {
        if (img.complete) {
          loaded++;
          if (loaded === imgs.length) resolve();
        } else {
          img.onload = img.onerror = () => {
            loaded++;
            if (loaded === imgs.length) resolve();
          };
        }
      });
    });
  `);

  await new Promise((r) => setTimeout(r, 600));

  const pdfBuffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: {
      marginType: 'default',
    },
  });

  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log('PDF 생성 완료:', pdfPath);

  if (fs.existsSync(tempHtmlPath)) {
    fs.unlinkSync(tempHtmlPath);
  }

  app.quit();
});

