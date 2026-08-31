# Figma Comment Viewer

Figma REST API 를 이용해 댓글 목록을 조회하고, 선택한 댓글의 쓰레드와 연결된 디자인을 함께 볼 수 있는 Electron 데스크탑 앱입니다.

## 기술 스택
- Electron (메인/렌더러 프로세스, IPC)
- Vanilla HTML/CSS/JavaScript (프레임워크 미사용)
- 설정 저장: 브라우저 `localStorage`
- 빌드: `electron-builder` (macOS `.dmg`, Windows `.exe`(NSIS), Linux `.AppImage`)

## 프로젝트 구조
```
figma-comment/
├─ main.js            # 메인 프로세스: 창 생성, Figma API 호출(IPC 핸들러)
├─ preload.js         # contextBridge 로 렌더러에 안전한 API 노출
├─ renderer/
│  ├─ index.html      # 목록/상세/설정 화면 마크업
│  ├─ style.css        # 스타일
│  └─ renderer.js      # 렌더러 로직 (검색, 목록, 상세, 답글)
├─ build/              # electron-builder 리소스(아이콘 등)
└─ package.json        # 스크립트 및 electron-builder 설정
```

## 사용 방법
1. 의존성 설치: `npm install`
2. 앱 실행: `npm start`
3. 실행 후 "설정" 화면에서 Figma Personal Access Token 과 File Key 를 입력하고 저장
   - "연결 테스트" 버튼으로 토큰 유효성을 `GET /v1/me` 호출로 확인 가능
4. "댓글 목록" 화면에서 종류(나를 맨션한 댓글 / 내가 쓴 댓글)와 최대 개수를 지정해 조회
5. 댓글 항목 클릭 시 상세 화면(쓰레드 + 디자인 미리보기 + 답글)으로 이동
6. "← 이전" 버튼으로 목록 화면 복귀

## 빌드
- `npm run build` : 현재 플랫폼용 unpacked 빌드 (테스트용)
- `npm run dist` : macOS(dmg) / Windows(nsis) / Linux(AppImage) 배포 패키지 생성

## 참고
- Figma API 는 멘션을 별도 구조로 제공하지 않아, "나를 맨션한 댓글"은 댓글 메시지에 현재 사용자의 handle 또는 id 가 포함되는지로 근사 판단합니다.
- 디자인 미리보기는 댓글의 `client_meta.node_id` (핀 댓글에 연결된 노드) 가 있는 경우에만 표시됩니다.
