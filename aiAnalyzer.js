// aiAnalyzer.js - Figma 텍스트 노드 및 댓글 데이터 추출 + AI(Copilot SDK / Antigravity CLI) 분석 모듈
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');

let CopilotSdkModule = null;
function loadCopilotSdk() {
  if (CopilotSdkModule === null) {
    try {
      CopilotSdkModule = require('@github/copilot-sdk');
    } catch (err) {
      CopilotSdkModule = false;
      console.error('@github/copilot-sdk 로드 실패:', err.message);
    }
  }
  return CopilotSdkModule || null;
}

// 패키징 환경(asar.unpacked) 및 개발 환경에서 네이티브 Copilot 런타임/CLI 바이너리 경로를 찾는다.
function resolveNativeCliPath() {
  const platformArch = `${process.platform}-${process.arch}`;
  const runtimeBinName = process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime';
  const legacyBinName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
  const sdkPkgName = `@github/copilot-sdk-${platformArch}`;
  const legacyPkgName = `@github/copilot-${platformArch}`;
  const rawCandidates = [];

  try {
    const sdkPkgJson = require.resolve(`${sdkPkgName}/package.json`);
    if (sdkPkgJson) {
      const sdkPkgDir = path.dirname(sdkPkgJson);
      rawCandidates.push(path.join(sdkPkgDir, 'prebuilds', platformArch, runtimeBinName));
    }
  } catch {
    // ignore
  }

  try {
    const copilotEntryPath = require.resolve('@github/copilot/package.json');
    const resolved = require.resolve(legacyPkgName, { paths: [path.dirname(copilotEntryPath)] });
    if (resolved) {
      rawCandidates.push(resolved);
    }
  } catch {
    // ignore
  }

  const baseDirs = [];
  if (process.resourcesPath) {
    baseDirs.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
  }
  if (typeof app?.getAppPath === 'function') {
    const appPath = app.getAppPath();
    baseDirs.push(appPath.replace('app.asar', 'app.asar.unpacked'));
  }
  baseDirs.push(__dirname);

  for (const base of baseDirs) {
    rawCandidates.push(
      path.join(
        base,
        'node_modules',
        '@github',
        `copilot-sdk-${platformArch}`,
        'prebuilds',
        platformArch,
        runtimeBinName
      ),
      path.join(base, 'node_modules', '@github', `copilot-${platformArch}`, legacyBinName),
      path.join(
        base,
        'node_modules',
        '@github',
        'copilot',
        'node_modules',
        `@github/copilot-${platformArch}`,
        legacyBinName
      )
    );
  }

  // app.asar 내부 경로는 직접 실행 및 chmod가 불가능하므로 반드시 app.asar.unpacked 경로로 치환한다.
  const candidates = [];
  for (const c of rawCandidates) {
    if (!c) continue;
    if (c.includes('app.asar') && !c.includes('app.asar.unpacked')) {
      candidates.push(c.replace('app.asar', 'app.asar.unpacked'));
    } else {
      candidates.push(c);
    }
  }

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        const stat = fsSync.statSync(candidate);
        if (stat.isFile()) {
          if (process.platform !== 'win32') {
            try {
              fsSync.chmodSync(candidate, 0o755);
            } catch {
              // ignore
            }
          }
          return candidate;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function sanitizeGithubToken(rawToken) {
  if (!rawToken) return '';
  return String(rawToken)
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function resolveAgyCliPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(home, '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ];

  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) {
        return c;
      }
    } catch {
      // ignore
    }
  }
  return 'agy';
}

function getAgyEnv() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  const currentPath = process.env.PATH || '';
  const mergedPath = Array.from(new Set([...extraPaths, ...currentPath.split(':')])).join(':');

  return {
    ...process.env,
    PATH: mergedPath,
  };
}

// 한국어 조사/어미 및 일반 불용어 제거 목록
const STOP_WORDS = new Set([
  '요청',
  '내용',
  '내용을',
  '데이터',
  '조회',
  '분석',
  '요약',
  '정리',
  '정리해',
  '정리해줘',
  '정리해주세요',
  '정보',
  '정보를',
  '정보에',
  '알려줘',
  '알려주세요',
  '알려',
  '해줘',
  '해주세요',
  '주세요',
  '부탁',
  '부탁해',
  '부탁해요',
  '부탁드립니다',
  '무엇',
  '어떤',
  '어떻게',
  '대한',
  '대해',
  '대해서',
  '관련',
  '관해',
  '관하여',
  '기반',
  '토대로',
  '가지고',
  '전달',
  '결과',
  '검색',
  '작성',
  '목록',
  '전체',
  '모든',
  '모두',
  '피그마',
  'figma',
  '텍스트',
  '노드',
  '댓글',
  '코멘트',
  '페이지',
  '화면',
  '확인',
  '확인해',
  '확인해줘',
  '확인해주세요',
  '설명',
  '설명해',
  '설명해줘',
  '설명해주세요',
  '에서',
  '으로',
  '그리고',
  '또는',
]);

// 로컬 정규식 기반 Fallback 검색어 추출기 (따옴표 구문 + 핵심 단어)
function extractSearchTermsFallback(query) {
  if (!query || typeof query !== 'string') {
    return { exactPhrases: [], keywords: [] };
  }

  const exactPhrases = new Set();
  // 따옴표로 감싸진 구문 추출 ('...', "...", “...”, ‘...’)
  const phraseRegex = /(?:'([^']+)'|"([^"]+)"|“([^”]+)”|‘([^’]+)’)/g;
  let match;
  while ((match = phraseRegex.exec(query)) !== null) {
    const phrase = (match[1] || match[2] || match[3] || match[4] || '').trim();
    if (phrase.length >= 2) {
      exactPhrases.add(phrase.toLowerCase());
      const noSpace = phrase.replace(/\s+/g, '').toLowerCase();
      if (noSpace.length >= 2) exactPhrases.add(noSpace);
    }
  }

  const rawTokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const keywords = new Set();
  const suffixRegex =
    /(에서|으로|에게|한테|부터|까지|이랑|하고|이나|처럼|만큼|보다|해줘|해주세요|알려줘|알려주세요|정리해줘|정리해주세요|분석해줘|요약해줘|확인해줘|확인해주세요|주세요|해|에|의|을|를|이|가|은|는|과|와|도|만|로|들)$/;

  for (const token of rawTokens) {
    if (!STOP_WORDS.has(token)) {
      keywords.add(token);
    }
    const stripped = token.replace(suffixRegex, '').trim();
    if (stripped.length >= 2 && !STOP_WORDS.has(stripped)) {
      keywords.add(stripped);
    }
  }

  // 따옴표 구문 내부 단어도 키워드로 보충
  for (const phrase of exactPhrases) {
    const parts = phrase
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2);
    for (const p of parts) {
      if (!STOP_WORDS.has(p)) keywords.add(p);
      const stripped = p.replace(suffixRegex, '').trim();
      if (stripped.length >= 2 && !STOP_WORDS.has(stripped)) keywords.add(stripped);
    }
  }

  return {
    exactPhrases: Array.from(exactPhrases),
    keywords: Array.from(keywords),
  };
}

// 댓글 배열을 루트 쓰레드 단위로 묶는다.
function groupCommentThreads(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const roots = [];
  const repliesByRoot = new Map();

  for (const c of list) {
    if (!c.parent_id) {
      roots.push(c);
    } else {
      if (!repliesByRoot.has(c.parent_id)) {
        repliesByRoot.set(c.parent_id, []);
      }
      repliesByRoot.get(c.parent_id).push(c);
    }
  }

  roots.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return roots.map((root) => {
    const replies = (repliesByRoot.get(root.id) || []).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    const allInThread = [root, ...replies];
    let nodeId = null;
    for (const item of allInThread) {
      if (item.client_meta && item.client_meta.node_id) {
        nodeId = item.client_meta.node_id;
        break;
      }
    }
    return {
      rootId: root.id,
      nodeId,
      createdAt: root.created_at,
      comments: allInThread.map((c) => ({
        id: c.id,
        author: (c.user && (c.user.handle || c.user.id)) || '알 수 없음',
        createdAt: c.created_at,
        message: c.message || '',
      })),
    };
  });
}

// Figma 파일 트리(document)를 순회하며 모든 노드 메타와 TEXT 노드를 수집한다.
function traverseFigmaDocument(documentNode) {
  const nodeMetaMap = new Map(); // nodeId -> { id, name, type, pageId, pageName, groupKey, groupName, ancestorIds, pathNames }
  const textNodes = []; // [{ id, name, characters, pageId, pageName, groupKey, groupName, ancestorIds, path }]

  function walk(node, context) {
    if (!node || typeof node !== 'object') return;

    const currentPage = node.type === 'CANVAS' ? { id: node.id, name: node.name || '페이지' } : context.page;

    // CANVAS 직속 자식(FRAME, SECTION, COMPONENT, COMPONENT_SET, GROUP 등)을 화면/섹션 그룹 단위로 설정
    let currentGroup = context.group;
    if (context.page && !context.group && node.type !== 'CANVAS' && node.type !== 'DOCUMENT') {
      currentGroup = {
        id: node.id,
        name: node.name || node.type,
        type: node.type,
      };
    }

    const ancestorIds = [...context.ancestorIds, node.id];
    const pathNames =
      node.type === 'DOCUMENT'
        ? context.pathNames
        : [...context.pathNames, node.name || node.type];

    const groupKey = currentGroup ? currentGroup.id : currentPage ? currentPage.id : 'root';
    const groupName = currentGroup
      ? currentGroup.name
      : currentPage
      ? `${currentPage.name} (캔버스 직속)`
      : '문서 루트';

    nodeMetaMap.set(node.id, {
      id: node.id,
      name: node.name || '',
      type: node.type || '',
      pageId: currentPage ? currentPage.id : '',
      pageName: currentPage ? currentPage.name : '',
      groupKey,
      groupName,
      ancestorIds,
      pathNames,
    });

    if (node.type === 'TEXT' && typeof node.characters === 'string' && node.characters.trim()) {
      textNodes.push({
        id: node.id,
        name: node.name || '',
        characters: node.characters.trim(),
        pageId: currentPage ? currentPage.id : '',
        pageName: currentPage ? currentPage.name : '',
        groupKey,
        groupName,
        ancestorIds,
        path: pathNames.join(' > '),
      });
    }

    if (Array.isArray(node.children)) {
      const nextContext = {
        page: currentPage,
        group: currentGroup,
        ancestorIds,
        pathNames,
      };
      for (const child of node.children) {
        walk(child, nextContext);
      }
    }
  }

  walk(documentNode, {
    page: null,
    group: null,
    ancestorIds: [],
    pathNames: [],
  });

  return { nodeMetaMap, textNodes };
}

// 텍스트 노드와 댓글 쓰레드를 화면/섹션 그룹 및 직접 연결 단위로 매핑하고 검색어 기반으로 추출한다.
function extractFigmaContext(fileData, rawComments, searchTermsInput, pageId) {
  const fileName = (fileData && fileData.name) || 'Figma 파일';
  const documentNode = fileData && fileData.document;
  const { nodeMetaMap, textNodes } = traverseFigmaDocument(documentNode);
  const allThreads = groupCommentThreads(rawComments);

  // searchTerms가 문자열로 전달된 경우 fallback 파서 실행, 객체인 경우 그대로 사용
  const searchTerms =
    typeof searchTermsInput === 'string'
      ? extractSearchTermsFallback(searchTermsInput)
      : {
          exactPhrases: (searchTermsInput && searchTermsInput.exactPhrases) || [],
          keywords: (searchTermsInput && searchTermsInput.keywords) || [],
        };

  const exactPhrases = searchTerms.exactPhrases.map((p) => p.toLowerCase());
  const keywords = searchTerms.keywords.map((k) => k.toLowerCase());

  // 특정 페이지가 지정된 경우 해당 페이지(하위 노드 포함)에 연결된 댓글 쓰레드만 대상으로 필터링한다.
  const threads = pageId
    ? allThreads.filter((th) => th.nodeId && nodeMetaMap.has(th.nodeId))
    : allThreads;

  // 그룹(페이지 > 최상위 프레임/섹션)별로 텍스트 노드와 댓글 쓰레드를 묶는다.
  const groupsMap = new Map();

  function ensureGroup(groupKey, pageName, groupName) {
    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        pageName: pageName || '페이지',
        groupName: groupName || '영역',
        textNodes: [],
        threads: [],
        score: 0,
        exactScore: 0,
      });
    }
    return groupsMap.get(groupKey);
  }

  for (const tn of textNodes) {
    const g = ensureGroup(tn.groupKey, tn.pageName, tn.groupName);
    g.textNodes.push(tn);
  }

  const unlinkedThreads = [];
  for (const thread of threads) {
    if (thread.nodeId && nodeMetaMap.has(thread.nodeId)) {
      const meta = nodeMetaMap.get(thread.nodeId);
      const g = ensureGroup(meta.groupKey, meta.pageName, meta.groupName);
      g.threads.push({
        ...thread,
        targetNodeName: meta.name,
        targetNodeType: meta.type,
        targetNodePath: meta.pathNames.join(' > '),
      });
    } else {
      unlinkedThreads.push({
        ...thread,
        targetNodeName: thread.nodeId ? `노드(${thread.nodeId})` : '전체 캔버스',
        targetNodeType: 'CANVAS',
        targetNodePath: '전체 캔버스',
      });
    }
  }

  // 각 그룹 및 텍스트 노드의 키워드 매칭 점수 계산
  const allGroups = Array.from(groupsMap.values());
  let matchedGroupCount = 0;

  if (exactPhrases.length > 0 || keywords.length > 0) {
    for (const group of allGroups) {
      let groupExactScore = 0;
      let groupScore = 0;
      const groupHeaderLower = `${group.pageName} ${group.groupName}`.toLowerCase();
      const groupHeaderNoSpace = groupHeaderLower.replace(/\s+/g, '');

      // 그룹 헤더 일치 검사
      for (const ep of exactPhrases) {
        if (groupHeaderLower.includes(ep) || groupHeaderNoSpace.includes(ep)) {
          groupExactScore += 50;
          groupScore += 50;
        }
      }
      for (const kw of keywords) {
        if (groupHeaderLower.includes(kw)) {
          groupScore += 5;
        }
      }

      // 텍스트 노드 일치 검사
      for (const tn of group.textNodes) {
        let tnExact = 0;
        let tnScore = 0;
        const textLower = `${tn.name} ${tn.characters} ${tn.path}`.toLowerCase();
        const textNoSpace = textLower.replace(/\s+/g, '');

        for (const ep of exactPhrases) {
          if (textLower.includes(ep) || textNoSpace.includes(ep)) {
            tnExact += 30;
            tnScore += 30;
          }
        }
        for (const kw of keywords) {
          if (textLower.includes(kw)) {
            tnScore += 3;
          }
        }

        tn.exactScore = tnExact;
        tn.matchScore = tnScore;
        groupExactScore += tnExact;
        groupScore += tnScore;
      }

      // 댓글 일치 검사
      for (const th of group.threads) {
        let thExact = 0;
        let thScore = 0;
        const commentLower = th.comments
          .map((c) => `${c.author} ${c.message}`)
          .join(' ')
          .toLowerCase();
        const commentNoSpace = commentLower.replace(/\s+/g, '');

        for (const ep of exactPhrases) {
          if (commentLower.includes(ep) || commentNoSpace.includes(ep)) {
            thExact += 30;
            thScore += 30;
          }
        }
        for (const kw of keywords) {
          if (commentLower.includes(kw)) {
            thScore += 3;
          }
        }

        th.exactScore = thExact;
        th.matchScore = thScore;
        groupExactScore += thExact;
        groupScore += thScore;
      }

      group.exactScore = groupExactScore;
      group.score = groupScore;
      if (groupScore > 0) {
        matchedGroupCount++;
      }
    }
  }

  // 정렬: 필수 구문 일치 점수 최우선 -> 키워드 점수 -> 댓글 수 -> 노드 수
  const sortedGroups = [...allGroups].sort((a, b) => {
    if (b.exactScore !== a.exactScore) return b.exactScore - a.exactScore;
    if (b.score !== a.score) return b.score - a.score;
    if (b.threads.length !== a.threads.length) return b.threads.length - a.threads.length;
    return b.textNodes.length - a.textNodes.length;
  });

  // 매칭된 그룹이 있으면 매칭된 그룹(+ 댓글이 존재하는 그룹)을 우선 선택하고,
  // 매칭된 그룹이 없으면 전체 그룹을 선택한다.
  let selectedGroups;
  if (matchedGroupCount > 0) {
    const matched = sortedGroups.filter((g) => g.score > 0);
    const commentedExtras = sortedGroups.filter((g) => g.score === 0 && g.threads.length > 0);
    selectedGroups = [...matched, ...commentedExtras];
  } else {
    selectedGroups = sortedGroups;
  }

  return {
    fileName,
    searchTerms,
    exactPhrases,
    keywords,
    totalTextCount: textNodes.length,
    totalThreadCount: threads.length,
    matchedGroupCount,
    selectedGroups,
    unlinkedThreads,
    nodeMetaMap,
    threads,
  };
}

// Figma 디자인 화면, 특정 노드, 댓글 쓰레드 바로가기 URL 생성
function buildFigmaUrl({ fileKey, fileName, nodeId, commentId }) {
  const fileNameSlug = fileName
    ? `/${encodeURIComponent(fileName.trim().replace(/\s+/g, '-'))}`
    : '';
  const params = new URLSearchParams();
  if (nodeId && nodeId !== 'root') {
    params.set('node-id', String(nodeId).replace(/:/g, '-'));
  }
  const queryString = params.toString();
  const queryPart = queryString ? `?${queryString}` : '';
  const hashPart = commentId ? `#${encodeURIComponent(commentId)}` : '';
  return `https://www.figma.com/design/${encodeURIComponent(fileKey)}${fileNameSlug}${queryPart}${hashPart}`;
}

// AI 응답 텍스트 내 링크가 누락된 관련 화면, 관련 노드(ID), 댓글 쓰레드(ID)에 자동으로 Figma 링크를 연결한다.
function autoLinkFigmaReferences(markdownText, fileKey, context) {
  if (!markdownText) return '';
  const fileName = context.fileName;
  const nodeMetaMap = context.nodeMetaMap || new Map();
  const threadMap = new Map();
  for (const th of context.threads || []) {
    threadMap.set(String(th.rootId), th);
  }

  // 기존 마크다운 링크([텍스트](URL))와 일반 텍스트 구간을 분리하여 이미 링크된 부분은 건드리지 않는다.
  const markdownLinkRegex = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  const parts = markdownText.split(markdownLinkRegex);

  const processed = parts
    .map((part, idx) => {
      // 홀수 인덱스는 이미 마크다운 링크인 구간
      if (idx % 2 === 1) return part;

      let segment = part;

      // 1) 댓글 쓰레드 참조 자동 링크 (예: `쓰레드 #123456` 또는 `#123456`)
      segment = segment.replace(/(?:쓰레드\s*)?#(\d{4,})\b/g, (match, threadId) => {
        const th = threadMap.get(threadId);
        if (!th) return match;
        const url = buildFigmaUrl({
          fileKey,
          fileName,
          nodeId: th.nodeId,
          commentId: th.rootId,
        });
        return `[${match}](${url})`;
      });

      // 2) 백틱으로 감싸진 노드 ID 자동 링크 (예: `123:456` 또는 `I123:456;789:012`)
      segment = segment.replace(/`([I]?\d+:\d+(?:;\d+:\d+)*)`/g, (match, nodeId) => {
        if (!nodeMetaMap.has(nodeId)) return match;
        const url = buildFigmaUrl({ fileKey, fileName, nodeId });
        return `[${match}](${url})`;
      });

      // 3) 일반 텍스트 내 Node ID 패턴 자동 링크 (예: Node 123:456, 노드 123:456, ID: 123:456)
      segment = segment.replace(
        /\b(Node|노드|ID|화면\s*ID)\s*[:#]?\s*([I]?\d+:\d+(?:;\d+:\d+)*)/gi,
        (match, label, nodeId) => {
          if (!nodeMetaMap.has(nodeId)) return match;
          const url = buildFigmaUrl({ fileKey, fileName, nodeId });
          return `[${label} \`${nodeId}\`](${url})`;
        }
      );

      // 4) 백틱으로 감싸진 관련 화면(프레임/섹션) 이름 자동 링크
      if (Array.isArray(context.selectedGroups)) {
        for (const group of context.selectedGroups) {
          if (!group.groupKey || group.groupKey === 'root' || !group.groupName) continue;
          const groupUrl = buildFigmaUrl({ fileKey, fileName, nodeId: group.groupKey });
          const escapedGroupName = group.groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const escapedPageName = (group.pageName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (escapedPageName) {
            const fullPathRegex = new RegExp(
              `\`(${escapedPageName}\\s*>\\s*${escapedGroupName})\``,
              'g'
            );
            segment = segment.replace(fullPathRegex, `[$1](${groupUrl})`);
          }
          if (group.groupName.length >= 2) {
            const nameRegex = new RegExp(`\`(${escapedGroupName})\``, 'g');
            segment = segment.replace(nameRegex, `[$1](${groupUrl})`);
          }
        }
      }

      return segment;
    })
    .join('');

  return processed;
}

// 추출된 Figma 텍스트 노드와 댓글 데이터를 AI 프롬프트용 Markdown 문자열로 조합한다.
function buildAiAnalysisPrompt(query, fileKey, context) {
  const MAX_CONTEXT_CHARS = 45000;
  let currentChars = 0;
  const sections = [];
  let includedTextCount = 0;
  let includedThreadCount = 0;
  const fileName = context.fileName;
  const fileRootUrl = buildFigmaUrl({ fileKey, fileName });

  for (const group of context.selectedGroups) {
    if (group.textNodes.length === 0 && group.threads.length === 0) continue;

    const lines = [];
    const exactBadge = group.exactScore > 0 ? ` ⭐[핵심구문 일치: ${group.exactScore}점]` : '';
    const matchBadge = group.score > 0 ? ` [매칭 점수: ${group.score}점]` : '';
    const groupUrl = buildFigmaUrl({
      fileKey,
      fileName,
      nodeId: group.groupKey,
    });
    lines.push(
      `### 관련 화면: [${group.pageName} > ${group.groupName}](${groupUrl}) (화면 ID: \`${group.groupKey}\`)${exactBadge}${matchBadge}`
    );

    // 그룹 내 텍스트 노드 정리 (필수 구문 일치 > 키워드 매칭 순 우선, 동일 텍스트 중복 축약)
    const nodesToRender = [...group.textNodes].sort(
      (a, b) =>
        (b.exactScore || 0) - (a.exactScore || 0) ||
        (b.matchScore || 0) - (a.matchScore || 0)
    );

    if (nodesToRender.length > 0) {
      lines.push(`\n#### 관련 텍스트 노드 (${nodesToRender.length}건)`);
      const seenTexts = new Set();
      let renderedInGroup = 0;
      let unmatchedRendered = 0;

      for (const tn of nodesToRender) {
        const isMatched = (tn.exactScore || 0) > 0 || (tn.matchScore || 0) > 0;
        // 매칭되지 않은 주변 노드는 문맥 이해용으로 최대 6개까지만 포함하여 다른 중요 그룹의 컨텍스트를 보존한다.
        if (!isMatched && unmatchedRendered >= 6) {
          continue;
        }

        const dedupKey = `${tn.name}::${tn.characters}`;
        if (seenTexts.has(dedupKey) && !isMatched) continue;
        seenTexts.add(dedupKey);

        const compactText = tn.characters.replace(/\s+/g, ' ').trim();
        const nodeUrl = buildFigmaUrl({ fileKey, fileName, nodeId: tn.id });
        const star = (tn.exactScore || 0) > 0 ? ' ⭐[핵심일치]' : '';
        lines.push(
          `- **[Node \`${tn.id}\` (${tn.name || 'TEXT'})](${nodeUrl})**${star}: ${compactText}`
        );
        renderedInGroup++;
        includedTextCount++;
        if (!isMatched) unmatchedRendered++;
        if (renderedInGroup >= 40) {
          lines.push(`- ...(외 ${nodesToRender.length - renderedInGroup}개 텍스트 노드 생략)`);
          break;
        }
      }
    }

    // 그룹 내 연결된 댓글 쓰레드 정리
    if (group.threads.length > 0) {
      lines.push(`\n#### 연결된 댓글 쓰레드 / 참고 논의 (${group.threads.length}건)`);
      for (const th of group.threads) {
        includedThreadCount++;
        const threadUrl = buildFigmaUrl({
          fileKey,
          fileName,
          nodeId: th.nodeId,
          commentId: th.rootId,
        });
        const targetNodeUrl = th.nodeId
          ? buildFigmaUrl({ fileKey, fileName, nodeId: th.nodeId })
          : fileRootUrl;
        lines.push(
          `- **[쓰레드 #${th.rootId}](${threadUrl})** (연결 노드: [\`${th.nodeId || '없음'}\`](${targetNodeUrl}) - ${th.targetNodePath || th.targetNodeName})`
        );
        for (const c of th.comments) {
          const msg = (c.message || '').replace(/\n/g, ' ');
          lines.push(`  - **${c.author}** (${c.createdAt || ''}): ${msg}`);
        }
      }
    }

    const sectionText = lines.join('\n') + '\n';
    if (currentChars + sectionText.length > MAX_CONTEXT_CHARS && sections.length > 0) {
      sections.push(`\n> *(컨텍스트 길이 제한으로 일부 하위 섹션이 생략되었습니다.)*\n`);
      break;
    }
    sections.push(sectionText);
    currentChars += sectionText.length;
  }

  // 특정 노드에 매칭되지 않은 전체/캔버스 댓글 쓰레드 추가
  if (context.unlinkedThreads.length > 0 && currentChars < MAX_CONTEXT_CHARS) {
    const lines = [`### [전체 캔버스 / 기타 댓글 쓰레드 (${context.unlinkedThreads.length}건)]`];
    for (const th of context.unlinkedThreads) {
      includedThreadCount++;
      const threadUrl = buildFigmaUrl({
        fileKey,
        fileName,
        nodeId: th.nodeId,
        commentId: th.rootId,
      });
      lines.push(
        `- **[쓰레드 #${th.rootId}](${threadUrl})** (노드 ID: \`${th.nodeId || '전체 캔버스'}\`)`
      );
      for (const c of th.comments) {
        const msg = (c.message || '').replace(/\n/g, ' ');
        lines.push(`  - **${c.author}** (${c.createdAt || ''}): ${msg}`);
      }
    }
    sections.push(lines.join('\n') + '\n');
  }

  const figmaDataMarkdown =
    sections.length > 0
      ? sections.join('\n---\n\n')
      : '조회된 텍스트 노드 또는 댓글 데이터가 없습니다.';

  const prompt = `당신은 Figma 디자인/기획 텍스트 데이터와 댓글(피드백/논의사항)을 분석하는 전문 AI 어시스턴트입니다.
아래 사용자의 **[요청 내용]**을 바탕으로, Figma에서 조회된 **[텍스트 노드 데이터 및 연결된 댓글 데이터]**를 면밀히 분석하여 한국어 Markdown 문서로 답변을 작성해 주세요.

## 1. 사용자 요청 내용
${query.trim()}

## 2. Figma 파일 메타 정보
- **파일 이름**: [${context.fileName}](${fileRootUrl})
- **File Key**: \`${fileKey}\`
- **추출 핵심 키워드**: ${
    context.exactPhrases && context.exactPhrases.length > 0
      ? `핵심구문 [${context.exactPhrases.join(', ')}], `
      : ''
  }${context.keywords && context.keywords.length > 0 ? context.keywords.join(', ') : '(전체 조회)'}
- **전체 텍스트 노드 수**: ${context.totalTextCount}개 (분석 포함: ${includedTextCount}개)
- **전체 댓글 쓰레드 수**: ${context.totalThreadCount}개 (분석 포함: ${includedThreadCount}개)

## 3. 분석 작성 지침
1. 사용자의 **요청 내용**에 정확히 부합하는 핵심 분석 결과를 가장 먼저 명확하게 제시해 주세요.
2. 관련된 **Figma 텍스트 노드의 주요 문구/기획 내용**과 그에 연결된 **댓글 쓰레드(작성자, 피드백, 수정 요청, 의사결정 내역 등)**를 서로 연결하여 구조적으로 정리해 주세요.
3. **링크 연결 필수 지침**:
   - 본문 및 요약 표/목록에서 **관련 화면(페이지/프레임/섹션)**, **관련 노드(텍스트 노드 및 타겟 노드)**, **참고 자료(댓글 쓰레드, 외부 참고 URL 등)**를 언급할 때는 반드시 아래 데이터에 제공된 URL을 사용해 클릭 가능한 마크다운 링크 형식(예: \`[화면명](URL)\`, \`[Node ID (노드명)](URL)\`, \`[쓰레드 #ID](URL)\`)으로 작성해 주세요.
   - 문서 하단에 **\`## 관련 화면 · 관련 노드 · 참고 자료\`** 섹션을 반드시 포함하여, 분석 결과와 관련된 **(1) 관련 화면 링크**, **(2) 관련 노드 링크**, **(3) 참고 자료(댓글 쓰레드 및 참고 URL) 링크**를 분류해 정리해 주세요.
4. 별도의 도구 호출이나 파일 탐색 없이, 아래에 제공된 데이터만을 근거로 즉시 최종 Markdown 응답을 출력해 주세요.

---

## 4. 조회된 Figma 텍스트 노드 및 댓글 데이터

${figmaDataMarkdown}
`;

  return {
    prompt,
    includedTextCount,
    includedThreadCount,
  };
}

// GitHub Copilot SDK에서 지원 모델 목록 조회
async function listCopilotModels(githubToken) {
  const sdk = loadCopilotSdk();
  if (!sdk) {
    throw new Error('@github/copilot-sdk 를 로드할 수 없습니다.');
  }
  const { CopilotClient, RuntimeConnection } = sdk;

  const token = sanitizeGithubToken(githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  const clientOptions = {};
  if (token) {
    clientOptions.gitHubToken = token;
    clientOptions.useLoggedInUser = false;
  }
  const nativeCliPath = resolveNativeCliPath();
  if (nativeCliPath) {
    clientOptions.connection = RuntimeConnection.forStdio({ path: nativeCliPath });
  }

  const client = new CopilotClient(clientOptions);
  try {
    await client.start();
    const models = await client.listModels();
    return (Array.isArray(models) ? models : []).map((m) => {
      let pricing = '';
      const tp = m.billing && m.billing.tokenPrices;
      if (tp && typeof tp.inputPrice === 'number' && typeof tp.outputPrice === 'number') {
        const inVal = (tp.inputPrice / 100).toFixed(2);
        const outVal = (tp.outputPrice / 100).toFixed(2);
        pricing = `입력 $${inVal} / 출력 $${outVal} (1M tok)`;
      }
      return {
        id: m.id,
        name: m.name || m.id,
        pricing,
      };
    });
  } finally {
    try {
      await client.stop();
    } catch {
      // ignore
    }
  }
}

// Antigravity CLI 모델별 1M 토큰당 기준 단가 매핑 테이블
const AGY_MODEL_PRICING_MAP = {
  'gemini-3.8-flash-low': '입력 $0.15 / 출력 $0.60 (1M tok)',
  'gemini-3.8-flash-medium': '입력 $0.15 / 출력 $0.60 (1M tok)',
  'gemini-3.8-flash-high': '입력 $0.15 / 출력 $0.60 (1M tok)',
  'gemini-4-argon-low': '입력 $1.25 / 출력 $5.00 (1M tok)',
  'gemini-4-argon-medium': '입력 $1.25 / 출력 $5.00 (1M tok)',
  'gemini-4-argon-high': '입력 $1.25 / 출력 $5.00 (1M tok)',
  'claude-sonnet-5-5-low': '입력 $3.00 / 출력 $15.00 (1M tok)',
  'claude-sonnet-5-5-medium': '입력 $3.00 / 출력 $15.00 (1M tok)',
  'claude-sonnet-5-5-high': '입력 $3.00 / 출력 $15.00 (1M tok)',
  'claude-opus-5-5-low': '입력 $15.00 / 출력 $75.00 (1M tok)',
  'claude-opus-5-5-medium': '입력 $15.00 / 출력 $75.00 (1M tok)',
  'claude-opus-5-5-high': '입력 $15.00 / 출력 $75.00 (1M tok)',
  'gpt-oss-120b-medium': '입력 $0.30 / 출력 $1.20 (1M tok)',
};

// Antigravity CLI (`agy models`)에서 지원 모델 목록 조회
async function listAntigravityModels() {
  const agyPath = resolveAgyCliPath();
  return new Promise((resolve, reject) => {
    execFile(
      agyPath,
      ['models'],
      {
        env: getAgyEnv(),
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              `Antigravity CLI 모델 목록 조회 오류: ${error.message}${stderr ? `\n${stderr}` : ''}`
            )
          );
        }
        // 스피너/제어문자 제거 후 라인별 파싱
        const cleanOutput = (stdout || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        const lines = cleanOutput
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        const models = [];
        const seen = new Set();
        for (const line of lines) {
          if (/fetching available models/i.test(line)) continue;
          const match = line.match(/^([a-z0-9][a-z0-9._-]*)(?:\t+|\s{2,})(.+)$/i);
          if (match) {
            const id = match[1].trim();
            const name = match[2].trim();
            if (!seen.has(id)) {
              seen.add(id);
              const pricing = AGY_MODEL_PRICING_MAP[id.toLowerCase()] || '';
              models.push({ id, name, pricing });
            }
          }
        }
        resolve(models);
      }
    );
  });
}

async function listAvailableModels({ aiModule, githubToken }) {
  if (aiModule === 'antigravity') {
    return listAntigravityModels();
  }
  return listCopilotModels(githubToken);
}

// GitHub Copilot SDK를 사용해 분석 실행
async function runCopilotSdkAnalysis(prompt, githubToken, workDir, aiModel) {
  const sdk = loadCopilotSdk();
  if (!sdk) {
    throw new Error('@github/copilot-sdk 를 로드할 수 없습니다. 패키지 설치 상태를 확인해 주세요.');
  }
  const { CopilotClient, RuntimeConnection } = sdk;

  const token = sanitizeGithubToken(githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  const clientOptions = {
    workingDirectory: workDir,
  };
  if (token) {
    clientOptions.gitHubToken = token;
    clientOptions.useLoggedInUser = false;
  }
  const nativeCliPath = resolveNativeCliPath();
  if (nativeCliPath) {
    clientOptions.connection = RuntimeConnection.forStdio({ path: nativeCliPath });
  }

  const client = new CopilotClient(clientOptions);
  try {
    await client.start();
    const sessionOpts =
      aiModel && aiModel.trim() && aiModel.trim() !== 'auto' ? { model: aiModel.trim() } : {};
    const session = await client.createSession(sessionOpts);
    try {
      const result = await session.sendAndWait(prompt, 180000);
      const content = result?.data?.content || '';
      if (!content.trim()) {
        throw new Error('Copilot으로부터 빈 응답을 받았습니다.');
      }
      return content;
    } finally {
      try {
        await session.disconnect();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    if (token && /Bad credentials|401/i.test(err.message || '')) {
      throw new Error(
        '설정된 GitHub 토큰이 거부되었습니다(Bad credentials). 토큰 값을 확인하거나 설정에서 비워 두어 로컬에 로그인된 Copilot CLI 인증을 사용해 보세요.'
      );
    }
    throw err;
  } finally {
    try {
      await client.stop();
    } catch {
      // ignore
    }
  }
}

// 로컬 Antigravity CLI (agy)를 사용해 분석 실행
async function runAntigravityCliAnalysis(prompt, workDir, aiModel) {
  const agyPath = resolveAgyCliPath();
  const args = [];
  if (aiModel && aiModel.trim()) {
    args.push('--model', aiModel.trim());
  }
  args.push('--print', prompt, '--disable-slash-commands', '--dangerously-skip-permissions');

  return new Promise((resolve, reject) => {
    execFile(
      agyPath,
      args,
      {
        cwd: workDir,
        env: getAgyEnv(),
        timeout: 300000,
        maxBuffer: 15 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(
              `Antigravity CLI 실행 중 오류가 발생했습니다: ${error.message}${
                stderr ? `\n${stderr}` : ''
              }`
            )
          );
        }
        const output = (stdout || '').trim();
        if (!output) {
          return reject(new Error('Antigravity CLI로부터 응답 결과가 비어 있습니다.'));
        }
        resolve(output);
      }
    );
  });
}

// AI를 사용해 사용자 질의에서 Figma 검색에 필요한 핵심 고유 구문(Exact Phrase)과 키워드를 1차 추출한다.
async function extractSearchTermsWithAi({
  query,
  aiModule,
  aiModel,
  githubToken,
  workDir,
}) {
  const fallbackTerms = extractSearchTermsFallback(query);

  const prompt = `당신은 Figma 디자인 및 기획 문서 검색 엔진을 위한 질의어 분석기입니다.
사용자의 질문을 분석하여 Figma 텍스트 노드 및 댓글에서 검색해야 할 핵심 검색어를 JSON 형식으로만 응답해 주세요.

[사용자 질문]
${query}

[추출 지침]
1. "exactPhrases": 사용자가 따옴표('...' 또는 "...")로 감싼 단어/구문이나 반드시 어순 그대로 일치해야 하는 고유 명칭 (예: ["보증금 상태"]). 없으면 빈 배열 []
2. "keywords": Figma 화면의 텍스트 노드 또는 댓글에서 찾아야 할 핵심 키워드 목록 (예: ["보증금", "상태", "환급", "납부", "반환", "차감", "예치금", "deposit"]).
   - 절대 금지: '정보', '내용', '정리', '분석', '요약', '주세요', '알려줘', '대한', '관련' 같은 일반 지시어, 서술어, 불용어는 절대 포함하지 마세요.
3. 다른 설명 없이 오직 순수한 JSON 객체 하나만 출력하세요:
{"exactPhrases": ["..."], "keywords": ["..."]}`;

  try {
    const selectedModule = aiModule === 'antigravity' ? 'antigravity' : 'copilot';
    const trimmedModel = (aiModel && aiModel.trim()) || '';
    let rawOutput = '';

    if (selectedModule === 'antigravity') {
      rawOutput = await runAntigravityCliAnalysis(prompt, workDir, trimmedModel);
    } else {
      rawOutput = await runCopilotSdkAnalysis(prompt, githubToken, workDir, trimmedModel);
    }

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackTerms;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const rawExact = Array.isArray(parsed.exactPhrases) ? parsed.exactPhrases : [];
    const rawKw = Array.isArray(parsed.keywords) ? parsed.keywords : [];

    const cleanedExact = new Set(fallbackTerms.exactPhrases);
    for (const ep of rawExact) {
      if (typeof ep === 'string' && ep.trim().length >= 2) {
        cleanedExact.add(ep.trim().toLowerCase());
        const noSpace = ep.replace(/\s+/g, '').toLowerCase();
        if (noSpace.length >= 2) cleanedExact.add(noSpace);
      }
    }

    const cleanedKeywords = new Set();
    for (const kw of rawKw) {
      if (typeof kw === 'string') {
        const lower = kw.trim().toLowerCase();
        if (lower.length >= 2 && !STOP_WORDS.has(lower)) {
          cleanedKeywords.add(lower);
        }
      }
    }

    // fallback의 키워드 중에서도 유효한 키워드는 보충
    for (const kw of fallbackTerms.keywords) {
      cleanedKeywords.add(kw);
    }

    return {
      exactPhrases: Array.from(cleanedExact),
      keywords: Array.from(cleanedKeywords),
      usedAi: true,
    };
  } catch (err) {
    console.warn('[AI 핵심 키워드 추출 실패 - 로컬 Fallback 사용]:', err.message);
    return {
      ...fallbackTerms,
      usedAi: false,
    };
  }
}

function formatTimestampForFilename(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

async function analyzeFigmaWithAi({
  fileKey,
  pageId,
  pageName,
  fileData,
  comments,
  query,
  aiModule,
  aiModel,
  githubToken,
  aiSaveDir,
}) {
  const targetSaveDir =
    (aiSaveDir && aiSaveDir.trim()) || path.join(app.getPath('home'), 'figma-ai-results');
  await fs.mkdir(targetSaveDir, { recursive: true });

  const selectedModule = aiModule === 'antigravity' ? 'antigravity' : 'copilot';
  const trimmedModel = (aiModel && aiModel.trim()) || '';

  // 1단계: 사용자 질의를 AI에게 먼저 보내 핵심 고유 구문(Exact Phrase) 및 유효 키워드를 추출
  const searchTerms = await extractSearchTermsWithAi({
    query,
    aiModule: selectedModule,
    aiModel: trimmedModel,
    githubToken,
    workDir: targetSaveDir,
  });

  // 2단계: 추출된 핵심 구문과 키워드를 기반으로 Figma 노드/댓글을 정밀 스코어링 및 선별
  const context = extractFigmaContext(fileData, comments, searchTerms, pageId);
  const resolvedPageName =
    pageName ||
    (fileData &&
      fileData.document &&
      fileData.document.children &&
      fileData.document.children[0] &&
      fileData.document.children[0].name) ||
    '전체';
  context.pageId = pageId || '';
  context.pageName = resolvedPageName;

  // 3단계: 선별된 Figma 텍스트 데이터를 종합하여 최종 AI 분석 프롬프트 조합
  const { prompt, includedTextCount, includedThreadCount } = buildAiAnalysisPrompt(
    query,
    fileKey,
    context
  );

  let aiResponseText = '';

  // 4단계: AI 최종 종합 분석 실행
  if (selectedModule === 'antigravity') {
    aiResponseText = await runAntigravityCliAnalysis(prompt, targetSaveDir, trimmedModel);
  } else {
    aiResponseText = await runCopilotSdkAnalysis(prompt, githubToken, targetSaveDir, trimmedModel);
  }

  const linkedAiResponseText = autoLinkFigmaReferences(
    aiResponseText.trim(),
    fileKey,
    context
  );
  const fileRootUrl = buildFigmaUrl({ fileKey, fileName: context.fileName });
  const pageUrl = pageId
    ? buildFigmaUrl({ fileKey, fileName: context.fileName, nodeId: pageId })
    : fileRootUrl;

  const now = new Date();
  const fileName = `figma_ai_${formatTimestampForFilename(now)}.md`;
  const filePath = path.join(targetSaveDir, fileName);

  const baseModuleLabel =
    selectedModule === 'antigravity' ? 'Antigravity CLI (`agy`)' : 'GitHub Copilot SDK';
  const moduleLabel = trimmedModel
    ? `${baseModuleLabel} (${trimmedModel})`
    : baseModuleLabel;

  const keywordDisplay = [
    context.exactPhrases && context.exactPhrases.length > 0
      ? `핵심구문 [${context.exactPhrases.join(', ')}]`
      : '',
    context.keywords && context.keywords.length > 0 ? context.keywords.join(', ') : '',
  ]
    .filter(Boolean)
    .join(' / ');

  const savedMarkdown = `# Figma AI 데이터 분석 결과

- **분석 일시**: ${now.toLocaleString('ko-KR')}
- **Figma 파일**: [${context.fileName}](${fileRootUrl}) (\`${fileKey}\`)
- **대상 페이지**: [${resolvedPageName}](${pageUrl})${pageId ? ` (\`${pageId}\`)` : ''}
- **사용 AI 모듈**: ${moduleLabel}
- **추출 검색 키워드**: ${keywordDisplay || '(전체)'}${context.searchTerms && context.searchTerms.usedAi ? ' (AI 질의 분석 반영)' : ''}
- **조회 데이터**: 텍스트 노드 ${includedTextCount}개 (페이지 전체 ${context.totalTextCount}개) / 댓글 쓰레드 ${includedThreadCount}개 (페이지 전체 ${context.totalThreadCount}개)

## 요청 내용
> ${query.trim().replace(/\n/g, '\n> ')}

---

${linkedAiResponseText}
`;

  await fs.writeFile(filePath, savedMarkdown, 'utf-8');

  return {
    markdown: savedMarkdown,
    aiResponseText: linkedAiResponseText,
    filePath,
    meta: {
      fileName: context.fileName,
      fileKey,
      pageId: pageId || '',
      pageName: resolvedPageName,
      aiModule: selectedModule,
      aiModel: trimmedModel,
      moduleLabel,
      totalTextCount: context.totalTextCount,
      includedTextCount,
      totalThreadCount: context.totalThreadCount,
      includedThreadCount,
      generatedAt: now.toISOString(),
    },
  };
}

module.exports = {
  analyzeFigmaWithAi,
  listAvailableModels,
};

