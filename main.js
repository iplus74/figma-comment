// main.js - Electron 메인 프로세스
// Figma REST API 호출을 담당하고, 렌더러 프로세스와는 IPC 로 통신한다.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const aiAnalyzer = require('./aiAnalyzer');

const FIGMA_API_BASE = 'https://api.figma.com/v1';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 공통 Figma API 요청 헬퍼. 성공 시 { ok: true, data }, 실패 시 { ok: false, error } 형태로 반환한다.
async function figmaRequest(token, method, endpoint, body) {
  if (!token) {
    return { ok: false, error: 'Figma Personal Access Token 이 설정되지 않았습니다.' };
  }
  try {
    const res = await fetch(`${FIGMA_API_BASE}${endpoint}`, {
      method,
      headers: {
        'X-Figma-Token': token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { raw: text };
    }

    if (!res.ok) {
      const message = (data && (data.message || data.err)) || `HTTP ${res.status}`;
      return { ok: false, error: message, status: res.status };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// 현재 사용자 정보 조회 (연결 테스트 겸용)
ipcMain.handle('figma:getMe', async (_event, { token }) => {
  return figmaRequest(token, 'GET', '/me');
});

// 파일 댓글 목록 조회
ipcMain.handle('figma:getComments', async (_event, { token, fileKey }) => {
  if (!fileKey) {
    return { ok: false, error: 'File Key 가 설정되지 않았습니다.' };
  }
  return figmaRequest(token, 'GET', `/files/${encodeURIComponent(fileKey)}/comments`);
});

// 노드 이미지(디자인 미리보기) 조회
ipcMain.handle('figma:getImages', async (_event, { token, fileKey, nodeIds, scale }) => {
  if (!fileKey || !nodeIds || nodeIds.length === 0) {
    return { ok: false, error: 'File Key 또는 node id 가 없습니다.' };
  }
  const ids = encodeURIComponent(nodeIds.join(','));
  const s = scale || 0.5;
  return figmaRequest(
    token,
    'GET',
    `/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=jpg&scale=${s}`
  );
});

// 노드 메타정보(바운딩 박스 등) 조회
ipcMain.handle('figma:getNode', async (_event, { token, fileKey, nodeId }) => {
  if (!fileKey || !nodeId) {
    return { ok: false, error: 'File Key 또는 node id 가 없습니다.' };
  }
  return figmaRequest(
    token,
    'GET',
    `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`
  );
});

// 이미지 URL 을 새 창으로 열기
ipcMain.handle('app:openImage', (_event, { url }) => {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: '유효한 이미지 URL 이 아닙니다.' };
  }
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: '디자인 미리보기',
  });
  win.loadURL(url);
  return { ok: true };
});

// Google Chrome 브라우저로 URL 열기 (미설치 시 기본 브라우저 fallback)
ipcMain.handle('app:openExternal', async (_event, { url }) => {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: '유효한 URL 이 아닙니다.' };
  }

  let command;
  if (process.platform === 'darwin') {
    command = `open -a "Google Chrome" "${url}"`;
  } else if (process.platform === 'win32') {
    command = `start chrome "${url}"`;
  } else {
    command = `google-chrome "${url}" || google-chrome-stable "${url}"`;
  }

  return new Promise((resolve) => {
    exec(command, async (err) => {
      if (err) {
        // Chrome 실행 실패 시 시스템 기본 브라우저로 열기
        try {
          await shell.openExternal(url);
          resolve({ ok: true });
        } catch (shellErr) {
          resolve({ ok: false, error: shellErr.message });
        }
      } else {
        resolve({ ok: true });
      }
    });
  });
});

// 답글 등록
ipcMain.handle('figma:postComment', async (_event, { token, fileKey, message, commentId }) => {
  if (!fileKey) {
    return { ok: false, error: 'File Key 가 설정되지 않았습니다.' };
  }
  if (!message || !message.trim()) {
    return { ok: false, error: '메시지를 입력해주세요.' };
  }
  const body = { message };
  if (commentId) {
    body.comment_id = commentId;
  }
  return figmaRequest(token, 'POST', `/files/${encodeURIComponent(fileKey)}/comments`, body);
});

// 폴더 선택 다이얼로그 (AI 결과 저장 폴더 선택)
ipcMain.handle('settings:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  return { ok: true, folderPath: result.filePaths[0] };
});

// 기본 AI 결과 저장 폴더 경로 반환
ipcMain.handle('settings:getDefaultAiSaveDir', () => {
  return path.join(app.getPath('home'), 'figma-ai-results');
});

// 로컬 파일 또는 폴더를 파일 탐색기에서 열기
ipcMain.handle('app:openPath', async (_event, { targetPath, showInFolder }) => {
  if (!targetPath) {
    return { ok: false, error: '경로가 지정되지 않았습니다.' };
  }
  try {
    if (showInFolder) {
      shell.showItemInFolder(targetPath);
    } else {
      await shell.openPath(targetPath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

let markedParser = null;
async function getMarkedParser() {
  if (!markedParser) {
    const mod = await import('marked');
    markedParser = mod.marked || mod;
    if (typeof markedParser.use === 'function') {
      markedParser.use({
        renderer: {
          link(item) {
            // marked v4+ 객체 형태 { href, title, text, tokens } 또는 v3 이전 (href, title, text) 대응
            const href = typeof item === 'object' && item !== null ? item.href : arguments[0];
            const title = typeof item === 'object' && item !== null ? item.title : arguments[1];
            const text = typeof item === 'object' && item !== null ? item.text : arguments[2];
            const titleAttr = title ? ` title="${title}"` : '';
            return `<a href="${href || ''}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text || ''}</a>`;
          },
        },
      });
    }
    if (typeof markedParser.setOptions === 'function') {
      markedParser.setOptions({
        gfm: true,
        breaks: true,
      });
    }
  }
  return markedParser;
}

// 파일 내 페이지(CANVAS) 목록 조회 (depth=1 로 가볍게 조회)
ipcMain.handle('figma:getPages', async (_event, { token, fileKey }) => {
  if (!fileKey) {
    return { ok: false, error: 'File Key 가 설정되지 않았습니다.' };
  }
  const res = await figmaRequest(
    token,
    'GET',
    `/files/${encodeURIComponent(fileKey)}?depth=1`
  );
  if (!res.ok) {
    return res;
  }
  const children = (res.data && res.data.document && res.data.document.children) || [];
  const pages = children
    .filter((node) => node && node.type === 'CANVAS')
    .map((node) => ({
      id: node.id,
      name: node.name || '이름 없는 페이지',
    }));
  return {
    ok: true,
    data: {
      fileName: (res.data && res.data.name) || '',
      pages,
    },
  };
});

// AI 모듈별 지원 모델 목록 조회
ipcMain.handle('ai:getModels', async (_event, { aiModule, githubToken }) => {
  try {
    const models = await aiAnalyzer.listAvailableModels({ aiModule, githubToken });
    return { ok: true, data: { models } };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// AI 검색 및 데이터 분석 (Figma 텍스트 노드 + 댓글 조회 -> AI 분석 -> Markdown 저장 -> HTML 변환)
ipcMain.handle(
  'ai:searchAndAnalyze',
  async (
    _event,
    { token, fileKey, pageId, pageName, query, aiModule, aiModel, githubToken, aiSaveDir }
  ) => {
    if (!token) {
      return { ok: false, error: 'Figma Personal Access Token 이 설정되지 않았습니다.' };
    }
    if (!fileKey) {
      return { ok: false, error: 'File Key 가 설정되지 않았습니다.' };
    }
    if (!pageId) {
      return { ok: false, error: '조회할 페이지를 선택해주세요.' };
    }
    if (!query || !query.trim()) {
      return { ok: false, error: '요청 내용을 입력해주세요.' };
    }
    if (!aiSaveDir || !aiSaveDir.trim()) {
      return { ok: false, error: '설정에서 AI 결과 저장 폴더를 지정해주세요.' };
    }

    try {
      // 선택한 페이지 노드(하위 텍스트 노드 포함) 및 파일 댓글 데이터를 병렬 조회
      const normalizedPageId = String(pageId).replace(/-/g, ':');
      const [nodeRes, commentsRes] = await Promise.all([
        figmaRequest(
          token,
          'GET',
          `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(normalizedPageId)}`
        ),
        figmaRequest(token, 'GET', `/files/${encodeURIComponent(fileKey)}/comments`),
      ]);

      if (!nodeRes.ok) {
        return { ok: false, error: `Figma 페이지 데이터 조회 실패: ${nodeRes.error}` };
      }
      if (!commentsRes.ok) {
        return { ok: false, error: `Figma 댓글 조회 실패: ${commentsRes.error}` };
      }

      const nodesMap = (nodeRes.data && nodeRes.data.nodes) || {};
      const pageEntry = nodesMap[normalizedPageId] || Object.values(nodesMap)[0];
      const pageDoc = pageEntry && pageEntry.document;
      if (!pageDoc) {
        return { ok: false, error: `선택한 페이지(${pageId})의 데이터를 찾을 수 없습니다.` };
      }

      const fileData = {
        name: (nodeRes.data && nodeRes.data.name) || 'Figma 파일',
        lastModified: nodeRes.data && nodeRes.data.lastModified,
        document: {
          id: '0:0',
          type: 'DOCUMENT',
          children: [pageDoc],
        },
      };

      const analysisResult = await aiAnalyzer.analyzeFigmaWithAi({
        fileKey,
        pageId: normalizedPageId,
        pageName: pageName || pageDoc.name || '',
        fileData,
        comments: (commentsRes.data && commentsRes.data.comments) || [],
        query,
        aiModule,
        aiModel,
        githubToken,
        aiSaveDir,
      });

      let html = '';
      try {
        const parser = await getMarkedParser();
        html = parser.parse(analysisResult.markdown || '');
      } catch {
        html = `<pre>${analysisResult.markdown || ''}</pre>`;
      }

      return {
        ok: true,
        data: {
          ...analysisResult,
          html,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || String(err),
      };
    }
  }
);

