// renderer.js - 렌더러 프로세스 로직 (Vanilla JS)
// 설정은 localStorage 에 저장하고, Figma API 호출은 preload 로 노출된 window.figmaAPI 를 통해 main 프로세스에 위임한다.

const STORAGE_KEYS = {
  token: 'figma_token',
  fileKey: 'figma_file_key',
};

const state = {
  currentUser: null, // { id, handle, ... }
  comments: [], // 마지막으로 조회한 전체 댓글 목록 (파일 전체)
  selectedRootId: null,
  selectedCommentId: null, // 사용자가 선택한 특정 댓글/답글 id
  previewRequestId: 0,
  imageCache: new Map(), // nodeId -> 이미지 URL 캐시
  selectedNodeId: null, // 현재 미리보기 중인 노드 id
  fileName: null, // Figma 파일 이름
};

// ---------- 화면 전환 ----------
const screens = {
  list: document.getElementById('screen-list'),
  detail: document.getElementById('screen-detail'),
  settings: document.getElementById('screen-settings'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

document.getElementById('btn-nav-list').addEventListener('click', () => showScreen('list'));
document.getElementById('btn-nav-settings').addEventListener('click', () => showScreen('settings'));
document.getElementById('btn-back').addEventListener('click', () => showScreen('list'));

// ---------- 설정 ----------
const tokenInput = document.getElementById('settings-token');
const fileKeyInput = document.getElementById('settings-file-key');
const settingsStatus = document.getElementById('settings-status');

function loadSettings() {
  tokenInput.value = localStorage.getItem(STORAGE_KEYS.token) || '';
  fileKeyInput.value = localStorage.getItem(STORAGE_KEYS.fileKey) || '';
}

function getToken() {
  return localStorage.getItem(STORAGE_KEYS.token) || '';
}

function getFileKey() {
  return localStorage.getItem(STORAGE_KEYS.fileKey) || '';
}

function setStatus(el, message, type) {
  el.textContent = message || '';
  el.classList.remove('error', 'success');
  if (type) el.classList.add(type);
}

document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  localStorage.setItem(STORAGE_KEYS.token, tokenInput.value.trim());
  localStorage.setItem(STORAGE_KEYS.fileKey, fileKeyInput.value.trim());
  setStatus(settingsStatus, '저장되었습니다.', 'success');
});

document.getElementById('btn-test-connection').addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  setStatus(settingsStatus, '연결 확인 중...', null);
  try {
    const res = await window.figmaAPI.getMe(token);
    if (res.ok) {
      state.currentUser = res.data;
      setStatus(settingsStatus, `연결 성공: ${res.data.handle} (id: ${res.data.id})`, 'success');
    } else {
      setStatus(settingsStatus, `연결 실패: ${res.error}`, 'error');
    }
  } catch (err) {
    setStatus(settingsStatus, `연결 실패: ${err.message}`, 'error');
  }
});

// ---------- 댓글 목록 ----------
const listStatus = document.getElementById('list-status');
const commentListEl = document.getElementById('comment-list');

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString();
}

function authorName(comment) {
  return (comment.user && (comment.user.handle || comment.user.id)) || '알 수 없음';
}

// Figma 댓글 메시지에 현재 사용자가 멘션되었는지 판단한다.
// Figma REST API 는 멘션을 별도 구조로 제공하지 않으므로 message 문자열 내
// "@handle" 또는 사용자 id 포함 여부로 근사 판단한다.
function isMentioned(comment, user) {
  if (!user || !comment.message) return false;
  const msg = comment.message;
  if (user.handle && msg.includes(`@${user.handle}`)) return true;
  if (user.id && msg.includes(user.id)) return true;
  return false;
}

function isMine(comment, user) {
  return !!(user && comment.user && comment.user.id === user.id);
}

async function ensureCurrentUser() {
  if (state.currentUser) return state.currentUser;
  const token = getToken();
  const res = await window.figmaAPI.getMe(token);
  if (res.ok) {
    state.currentUser = res.data;
    return res.data;
  }
  throw new Error(res.error);
}

async function fetchAllComments() {
  const token = getToken();
  const fileKey = getFileKey();
  const res = await window.figmaAPI.getComments(token, fileKey);
  if (!res.ok) throw new Error(res.error);
  return res.data.comments || [];
}

function renderList(comments) {
  commentListEl.innerHTML = '';
  if (comments.length === 0) {
    setStatus(listStatus, '조회된 댓글이 없습니다.', null);
    return;
  }
  setStatus(listStatus, `${comments.length}개 조회됨`, 'success');
  comments.forEach((comment) => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    li.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(authorName(comment))}</span>
        <span class="comment-date">${formatDate(comment.created_at)}</span>
      </div>
      <div class="comment-message">${escapeHtml(comment.message || '')}</div>
    `;
    li.addEventListener('click', () => openDetail(comment));
    commentListEl.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('search-type').value;
  const maxNum = parseInt(document.getElementById('search-max-num').value, 10) || 50;
  const keyword = document.getElementById('search-keyword').value.trim().toLowerCase();

  if (!getToken() || !getFileKey()) {
    setStatus(listStatus, '설정 화면에서 Token 과 File Key 를 먼저 입력해주세요.', 'error');
    return;
  }

  setStatus(listStatus, '조회 중...', null);
  try {
    const user = await ensureCurrentUser();
    const all = await fetchAllComments();
    state.comments = all;

    let filtered;
    if (type === 'mention') {
      filtered = all.filter((c) => isMentioned(c, user));
    } else {
      filtered = all.filter((c) => isMine(c, user));
    }

    if (keyword) {
      filtered = filtered.filter((c) => (c.message || '').toLowerCase().includes(keyword));
    }

    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    filtered = filtered.slice(0, maxNum);

    renderList(filtered);
  } catch (err) {
    setStatus(listStatus, `조회 실패: ${err.message}`, 'error');
  }
});

// ---------- 댓글 상세 (쓰레드 + 디자인 미리보기 + 답글) ----------
const threadListEl = document.getElementById('thread-list');
const designImageEl = document.getElementById('design-image');
const designImageInnerEl = document.getElementById('design-image-inner');
const designPinEl = document.getElementById('design-pin');
const designStatusEl = document.getElementById('design-status');
const btnOpenFigma = document.getElementById('btn-open-figma');

function generateFigmaShareToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${result}-0`;
}

// Figma 상세보기 버튼을 클릭하면 기본 브라우저(Chrome 등)로 해당 Figma 댓글 쓰레드 링크를 연다.
btnOpenFigma.addEventListener('click', () => {
  const fileKey = getFileKey();
  if (!fileKey) {
    setStatus(designStatusEl, 'File Key가 설정되지 않았습니다.', 'error');
    return;
  }
  const nodeId = state.selectedNodeId;
  const commentId = state.selectedCommentId || state.selectedRootId;
  const fileNameSlug = state.fileName
    ? `/${encodeURIComponent(state.fileName.trim().replace(/\s+/g, '-'))}`
    : '';

  const params = new URLSearchParams();
  if (nodeId) {
    params.set('node-id', nodeId.replace(':', '-'));
  }
  params.set('t', generateFigmaShareToken());

  const queryString = params.toString();
  const hash = commentId ? `#${encodeURIComponent(commentId)}` : '';
  const url = `https://www.figma.com/design/${encodeURIComponent(fileKey)}${fileNameSlug}?${queryString}${hash}`;
  window.figmaAPI.openExternal(url);
});

// 미리보기 이미지를 클릭하면 scale 1 원본을 새 창으로 열다.
designImageEl.style.cursor = 'zoom-in';
designImageEl.addEventListener('click', async () => {
  const nodeId = state.selectedNodeId;
  if (!nodeId) return;
  const cacheKey = `${nodeId}@1`;
  let url = state.imageCache.get(cacheKey);
  if (!url) {
    const res = await window.figmaAPI.getImages(getToken(), getFileKey(), [nodeId], 1);
    if (!res.ok) {
      setStatus(designStatusEl, `이미지 조회 실패: ${res.error}`, 'error');
      return;
    }
    url = res.data.images && res.data.images[nodeId];
    if (!url) return;
    state.imageCache.set(cacheKey, url);
  }
  window.figmaAPI.openImage(url);
});
const replyForm = document.getElementById('reply-form');
const replyInput = document.getElementById('reply-input');
const replyStatus = document.getElementById('reply-status');
const replySubmitBtn = document.getElementById('btn-reply');

function getRootId(comment) {
  return comment.parent_id || comment.id;
}

function getThreadComments(rootId) {
  return state.comments
    .filter((c) => c.id === rootId || c.parent_id === rootId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function findPinMeta(threadComments) {
  for (const c of threadComments) {
    const meta = c.client_meta;
    if (meta && meta.node_id) {
      return { nodeId: meta.node_id, offset: meta.node_offset || null };
    }
  }
  return null;
}

function renderThread(threadComments, selfId) {
  threadListEl.innerHTML = '';
  threadComments.forEach((comment) => {
    const li = document.createElement('li');
    li.className = 'comment-item' + (comment.id === selfId ? ' self' : '');
    li.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(authorName(comment))}</span>
        <span class="comment-date">${formatDate(comment.created_at)}</span>
      </div>
      <div class="comment-message">${escapeHtml(comment.message || '')}</div>
    `;
    threadListEl.appendChild(li);
  });
}

// 이미지 위에 댓글 핀 마커를 배치한다.
function positionPin(offset, bounds) {
  if (!offset || !bounds || !bounds.width || !bounds.height) {
    designPinEl.classList.add('hidden');
    return;
  }
  const leftPct = Math.max(0, Math.min(100, (offset.x / bounds.width) * 100));
  const topPct = Math.max(0, Math.min(100, (offset.y / bounds.height) * 100));
  designPinEl.style.left = `${leftPct}%`;
  designPinEl.style.top = `${topPct}%`;
}


async function loadDesignPreview(pin) {
  const requestId = ++state.previewRequestId;
  designImageInnerEl.classList.add('hidden');
  designPinEl.classList.add('hidden');
  const nodeId = pin && pin.nodeId;
  state.selectedNodeId = nodeId || null;

  // 특정 노드에 연결되지 않은 전체(캔버스) 코멘트인 경우
  if (!nodeId) {
    if (requestId !== state.previewRequestId) return;
    setStatus(
      designStatusEl,
      '전체(캔버스) 디자인이거나 노드 정보가 없습니다. 상단의 [Figma 상세보기]를 이용해 주세요.',
      null
    );
    return;
  }

  setStatus(designStatusEl, '이미지 로딩 중...', null);
  try {
    const scale = 0.25;
    const cacheKey = `${nodeId}@${scale}`;
    let cachedUrl = state.imageCache.get(cacheKey);

    // 노드 메타정보(핀 위치용)와 이미지 URL 조회를 병렬로 처리
    const [boundsRes, imageRes] = await Promise.all([
      window.figmaAPI.getNode(getToken(), getFileKey(), nodeId),
      cachedUrl ? Promise.resolve(null) : window.figmaAPI.getImages(getToken(), getFileKey(), [nodeId], scale),
    ]);

    if (requestId !== state.previewRequestId) return;

    let doc = null;
    let bounds = null;
    if (boundsRes && boundsRes.ok) {
      if (boundsRes.data.name) {
        state.fileName = boundsRes.data.name;
      }
      doc =
        boundsRes.data.nodes &&
        boundsRes.data.nodes[nodeId] &&
        boundsRes.data.nodes[nodeId].document;
      bounds = (doc && doc.absoluteBoundingBox) || null;
    }

    // 캔버스/문서 전체 레벨(CANVAS, DOCUMENT)인 경우만 차단
    if (doc && (doc.type === 'CANVAS' || doc.type === 'DOCUMENT')) {
      designImageInnerEl.classList.add('hidden');
      setStatus(
        designStatusEl,
        '캔버스 전체에 작성된 코멘트는 미리보기를 지원하지 않습니다. 상단의 [Figma 상세보기]를 이용해 주세요.',
        null
      );
      return;
    }

    let url = cachedUrl;
    if (!url) {
      if (!imageRes.ok) {
        setStatus(designStatusEl, `이미지 조회 실패: ${imageRes.error}`, 'error');
        return;
      }
      url = imageRes.data.images && imageRes.data.images[nodeId];
      if (!url) {
        setStatus(designStatusEl, '이미지를 생성하지 못했습니다.', 'error');
        return;
      }
      state.imageCache.set(cacheKey, url);
    }

    designImageEl.src = url;
    designImageInnerEl.classList.remove('hidden');
    positionPin(pin.offset, bounds);
    setStatus(designStatusEl, '', null);
  } catch (err) {
    if (requestId !== state.previewRequestId) return;
    setStatus(designStatusEl, `이미지 조회 실패: ${err.message}`, 'error');
  }
}

function syncReplySubmitState() {
  replySubmitBtn.disabled = !state.selectedRootId || !replyInput.value.trim();
}

async function openDetail(comment) {
  const rootId = getRootId(comment);
  state.selectedRootId = rootId;
  state.selectedCommentId = comment.id;

  const threadComments = getThreadComments(rootId);
  renderThread(threadComments, comment.id);

  setStatus(replyStatus, '', null);
  replyInput.value = '';
  syncReplySubmitState();

  // 쓰레드가 준비되면 즉시 상세 화면을 보여주고, 이미지는 백그라운드로 로드한다.
  showScreen('detail');

  const pin = findPinMeta(threadComments);
  loadDesignPreview(pin).catch((err) => {
    setStatus(designStatusEl, `이미지 조회 실패: ${err.message}`, 'error');
  });
}

replyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = replyInput.value.trim();
  if (!message) {
    setStatus(replyStatus, '답글 내용을 입력하세요.', 'error');
    syncReplySubmitState();
    return;
  }
  if (!state.selectedRootId) {
    setStatus(replyStatus, '상세 댓글을 먼저 선택하세요.', 'error');
    syncReplySubmitState();
    return;
  }

  setStatus(replyStatus, '전송 중...', null);
  try {
    const res = await window.figmaAPI.postComment(
      getToken(),
      getFileKey(),
      message,
      state.selectedRootId
    );
    if (!res.ok) {
      setStatus(replyStatus, `전송 실패: ${res.error}`, 'error');
      return;
    }

    setStatus(replyStatus, '답글이 등록되었습니다.', 'success');
    replyInput.value = '';
    syncReplySubmitState();

    // 응답으로 받은 새 댓글만 로컬 상태에 반영해 전체 재조회를 피한다.
    if (res.data && res.data.id) {
      state.comments = [...state.comments, res.data];
      const threadComments = getThreadComments(state.selectedRootId);
      renderThread(threadComments, res.data.id);
    }
  } catch (err) {
    setStatus(replyStatus, `전송 실패: ${err.message}`, 'error');
  }
});

replyInput.addEventListener('input', () => {
  setStatus(replyStatus, '', null);
  syncReplySubmitState();
});

// ---------- 초기화 ----------
loadSettings();
showScreen(getToken() && getFileKey() ? 'list' : 'settings');
syncReplySubmitState();
