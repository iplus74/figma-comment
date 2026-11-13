# FigCommi (Figma Comment Viewer & AI Analyzer)

Figma REST API를 이용해 댓글 목록을 조회·관리하고, 선택한 페이지의 기획 텍스트 노드와 댓글 쓰레드를 **2단계 AI 파이프라인(Antigravity CLI / Claude CLI / GitHub Copilot SDK)**으로 종합 분석할 수 있는 Electron 데스크탑 앱입니다.

---

## 주요 기능

### 1. 댓글 목록 조회 및 상세 미리보기
- **맞춤 필터링**: 나를 멘션한 댓글 / 내가 작성한 댓글 / 전체 댓글 필터링 및 키워드 검색 지원
- **쓰레드 상세 및 디자인 미리보기**: 선택한 댓글의 전체 대화 쓰레드 확인 및 연결된 노드(`client_meta.node_id`)의 디자인 이미지 미리보기 제공
- **외부 연동**: 댓글 및 디자인 노드를 Google Chrome(또는 기본 브라우저)의 Figma 웹 화면으로 즉시 열기 지원

### 2. AI 검색 및 기획/댓글 종합 분석
- **페이지(`depth=1`) 선택 조회**: Figma 파일 내 최상위 페이지 목록을 불러와 원하는 페이지의 데이터만 타겟팅하여 분석
- **AI 모듈 및 모델 선택**:
  - **Antigravity CLI (`agy`)**, **Claude CLI (`claude`)**, **GitHub Copilot SDK (`@github/copilot-sdk`)** 지원
  - 각 모듈에서 지원하는 AI 모델 목록과 1M 토큰당 입/출력 가격 정보를 **하루 1회(당일 기준) 실시간 조회 후 캐시**하여 빠르게 제공
- **2단계 AI 분석 파이프라인 (2-Stage AI Pipeline)**:
  1. **1차 AI 질의 분석 (키워드 추출)**: 사용자의 질의를 AI에 먼저 전달하여 필수 고유 구문(`exactPhrases`)과 핵심 연관 키워드(`keywords`)를 추출하고 일반 불용어를 배제 (오류 시 로컬 정규식 기반 안전 Fallback 동작)
  2. **Figma 데이터 정밀 스코어링**: 선택된 페이지의 전체 `TEXT` 노드와 댓글 쓰레드를 스캔하여 핵심 구문 및 키워드 매칭 가중치에 따라 최적의 컨텍스트 선별
  3. **2차 AI 종합 보고서 생성**: 선별된 기획 텍스트와 댓글 논의를 종합 분석하여 구조화된 Markdown 문서 생성
- **Figma 링크 자동 연결 및 결과 저장**:
  - 분석 결과 내 언급된 관련 화면(프레임/섹션), 텍스트 노드 ID, 댓글 쓰레드 ID에 클릭 가능한 Figma 바로가기 링크 자동 연결
  - Markdown 문서로 저장 시 모든 관련 링크에 `target="_blank" rel="noopener noreferrer"` 속성을 적용하여 어떤 외부 뷰어/에디터에서도 클릭 시 새 창으로 열리도록 지원
  - 지정된 로컬 저장 폴더에 타임스탬프 기반 `.md` 파일 자동 저장 및 앱 내 팝업 레이어 뷰어 제공

### 3. 설정 관리
- **Figma 설정**: Personal Access Token, File Key 설정 및 `GET /v1/me` 연결 테스트
- **AI 설정**: 기본 AI 모듈(Antigravity CLI / Claude CLI / GitHub Copilot SDK) 선택, GitHub Token 설정, AI 분석 결과 저장 폴더 탐색기 지정

---

## 기술 스택
- **Runtime & UI**: Electron (Main / Preload / Renderer IPC 구조), Vanilla HTML/CSS/JavaScript
- **AI Integration**: `@github/copilot-sdk` (GitHub Copilot Runtime 연동), Antigravity CLI (`agy`), Claude CLI (`claude`)
- **Storage**: 브라우저 `localStorage` (설정값) 및 로컬 파일 시스템 (`.md` 분석 결과 저장)
- **Build**: `electron-builder` (macOS `.dmg`, Windows `NSIS`, Linux `AppImage`)

---

## 프로젝트 구조
```
figma-comment/
├─ main.js            # 메인 프로세스: 창 생성, Figma REST API 호출, AI 분석 및 다이얼로그 IPC 핸들러
├─ preload.js         # contextBridge를 통한 렌더러 안전 API(window.figmaAPI) 노출
├─ aiAnalyzer.js      # 2단계 AI 키워드 추출, Figma 문서 트리 스캔/스코어링, AI 모델 조회 및 보고서 생성
├─ renderer/
│  ├─ index.html      # 댓글 목록 / 댓글 상세 / AI 검색 / 설정 화면 및 결과 모달 마크업
│  ├─ style.css       # 다크 테마 UI 및 마크다운 모달 스타일
│  └─ renderer.js     # 화면 전환, 댓글 조회, AI 검색 요청 및 마크다운 렌더링 로직
├─ scripts/
│  └─ generate-icons.js # 앱 아이콘 생성 스크립트
├─ build/             # electron-builder 패키징용 아이콘 리소스
└─ package.json       # 의존성 및 빌드 스크립트 설정
```

---

## 사용 방법

1. **의존성 설치**
   ```bash
   npm install
   ```
2. **앱 실행**
   ```bash
   npm start
   ```
3. **초기 설정 ("설정" 탭)**
   - **Figma 설정**: Figma Personal Access Token과 File Key를 입력하고 **연결 테스트** 후 저장합니다.
   - **AI 설정**: 사용할 AI 모듈(`Antigravity CLI`, `Claude CLI` 또는 `GitHub Copilot SDK`)과 결과 Markdown 파일을 저장할 폴더 경로를 지정합니다.
4. **댓글 조회 ("댓글 목록" 탭)**
   - 댓글 종류와 최대 개수를 선택하고 **조회** 버튼을 클릭합니다.
   - 항목 클릭 시 쓰레드 대화 내역과 디자인 미리보기를 확인할 수 있습니다.
5. **AI 검색 ("AI 검색" 탭)**
   - 분석할 **페이지**를 선택하고 **요청 내용**(예: `'보증금 상태' 에 대한 정보를 정리해 주세요.`)과 **AI 모델**을 선택한 뒤 **요청** 버튼을 클릭합니다.
   - 분석이 완료되면 지정된 폴더에 `.md` 파일이 저장되고 팝업 레이어에서 링크가 연결된 분석 보고서를 바로 확인할 수 있습니다.

---

## 빌드 스크립트
- `npm run pack` : 현재 플랫폼용 unpacked 디렉토리 빌드 (테스트용)
- `npm run dist` : 현재 플랫폼용 배포 패키지 생성
- `npm run dist:mac` : macOS `.dmg` 설치 이미지 생성
- `npm run dist:win` : Windows NSIS 설치 프로그램 생성
- `npm run dist:linux` : Linux `AppImage` 패키지 생성
- `npm run dist:all` : macOS / Windows / Linux 전체 빌드

---

## 참고 사항
- Figma REST API는 멘션을 별도 메타데이터로 제공하지 않으므로, "나를 멘션한 댓글"은 댓글 본문에 현재 사용자의 `handle` 또는 `id`가 포함되어 있는지 여부로 판별합니다.
- 디자인 미리보기는 댓글의 `client_meta.node_id`(특정 노드에 핀 고정된 댓글)가 존재하는 경우 표시됩니다.
- 패키징된 앱(`app.asar`)에서 GitHub Copilot SDK 실행 시 네이티브 바이너리(`copilot-runtime`)가 정상 실행되도록 `asarUnpack` 설정이 적용되어 있습니다.
