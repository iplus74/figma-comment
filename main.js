// main.js - Electron 메인 프로세스
// Figma REST API 호출을 담당하고, 렌더러 프로세스와는 IPC 로 통신한다.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
