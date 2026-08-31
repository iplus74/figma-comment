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
  previewRequestId: 0,
  imageCache: new Map(), // nodeId -> 이미지 URL 캐시
  selectedNodeId: null, // 현재 미리보기 중인 노드 id
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

// 노드 바운딩 박스 기준으로 항목 크기를 판단한다. 가로/세로 중 하나가 이 값 이상이면 전체 이미지로 간주.
const FULL_IMAGE_THRESHOLD = 1440;

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
  designPinEl.classList.remove('hidden');
}

async function loadDesignPreview(pin) {
  const requestId = ++state.previewRequestId;
  designImageInnerEl.classList.add('hidden');
  designPinEl.classList.add('hidden');
  const nodeId = pin && pin.nodeId;
  state.selectedNodeId = nodeId || null;
  if (!nodeId) {
    if (requestId !== state.previewRequestId) return;
    setStatus(designStatusEl, '노드에 연결된 이미지가 없습니다.', null);
    return;
  }
  setStatus(designStatusEl, '이미지 로딩 중...', null);
  try {
    // 노드 크기를 조회해 전체 이미지 여부와 핀 위치 기준을 구한다.
    let bounds = null;
    const boundsRes = await window.figmaAPI.getNode(getToken(), getFileKey(), nodeId);
    if (requestId !== state.previewRequestId) return;
    if (boundsRes.ok) {
      const doc =
        boundsRes.data.nodes &&
        boundsRes.data.nodes[nodeId] &&
        boundsRes.data.nodes[nodeId].document;
      bounds = (doc && doc.absoluteBoundingBox) || null;
    }
    const isFullImage =
      !!bounds &&
      (bounds.width >= FULL_IMAGE_THRESHOLD || bounds.height >= FULL_IMAGE_THRESHOLD);
    const scale = isFullImage ? 0.25 : 0.5;

    const cacheKey = `${nodeId}@${scale}`;
    let url = state.imageCache.get(cacheKey);
    if (!url) {
      const res = await window.figmaAPI.getImages(getToken(), getFileKey(), [nodeId], scale);
      if (requestId !== state.previewRequestId) return;
      if (!res.ok) {
        setStatus(designStatusEl, `이미지 조회 실패: ${res.error}`, 'error');
        return;
      }
      url = res.data.images && res.data.images[nodeId];
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
