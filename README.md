<p align="center">
  <img src="addon/chrome/content/icons/favicon.svg" width="96" height="96" alt="Zotero Translation Reader" />
</p>

# Zotero Translation Reader

[한국어](README.md) · [English](README.en.md)

**Zotero에서 논문을 번역하고, 수식·그림·표는 원본으로 읽습니다.**

PDF 페이지 번역과 원본 시각 자료를 함께 보여주는 개인용 Zotero 플러그인입니다.
[windingwind의 Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)를 기반으로
[Kinetic27](https://github.com/Kinetic27)이 유지보수합니다.

<p align="center">
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest"><img src="https://img.shields.io/github/v/release/Kinetic27/zotero_paper_translate?label=latest%20release&color=blue" alt="Latest release" /></a>
  <a href="https://github.com/Kinetic27/zotero_paper_translate/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Kinetic27/zotero_paper_translate/test.yml?label=tests" alt="Test workflow status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="AGPL-3.0-or-later" /></a>
  <a href="#설치"><img src="https://img.shields.io/badge/Zotero-7.9.9--10.9.9%20%28advertised%29-blue" alt="Advertised Zotero compatibility 7.9.9 to 10.9.9" /></a>
</p>

<p align="center">
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi"><strong>최신 XPI 다운로드</strong></a>
  ·
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest">Releases</a>
  ·
  <a href="https://github.com/Kinetic27/zotero_paper_translate/issues">Issues</a>
</p>

## 주요 기능

- **페이지 단위 번역** — 현재 페이지를 번역하거나 페이지 이동에 맞춰 자동 번역합니다.
- **원본 수식·그림·표 보존** — 인식한 영역을 PDF에서 렌더링하며, 인라인 수식도 번역문 사이에 표시합니다.
- **페이지 경계 문맥 연결** — 페이지 사이에서 이어지는 문단을 읽기 문맥에 포함합니다.
- **번역 저장** — 성공한 페이지 번역을 로컬에 저장하고 다시 열 때 재사용합니다.
- **읽기 화면 선택** — 번역 중심 화면, 원문 표시, 별도 읽기 창을 제공합니다.
- **문서 전체 번역** — 페이지를 순서대로 처리하며 중간에 취소할 수 있습니다.
- **ChatGPT 계정 로그인** — 브라우저 OAuth로 연결하고 계정의 모델과 reasoning effort를 선택합니다.

## 설치

1. 위의 **[최신 XPI 다운로드](https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi)** 링크로
   `zotero-translation-reader.xpi`를 받습니다. 이 주소는 항상 최신 안정 릴리스의 파일을 가리킵니다.
   릴리스 페이지에는 `SHA256SUMS.txt`도 함께 게시되므로 내려받은 파일의 무결성을 확인할 수 있습니다.
   직접 빌드한 경우 `build/zotero-translation-reader.xpi`를 사용합니다.
2. Zotero에서 **도구 → 플러그인 → 톱니바퀴 → 파일에서 플러그인 설치**를 선택합니다.
3. `.xpi` 파일을 설치한 뒤 PDF를 열고 오른쪽 **Zotero Translation Reader** 패널을 엽니다.
4. 이후 새 버전은 게시된 업데이트 피드로 안내됩니다. 설치된 플러그인은 매니페스트의 업데이트 주소를 통해
   현재 빌드의 채널에 맞는 피드(안정판은 `update.json`, 베타판은 `update-beta.json`)를 확인하며, Zotero의
   **도구 → 플러그인 → 톱니바퀴 → 업데이트 확인**으로 즉시 확인할 수 있습니다.

매니페스트의 지원 범위는 Zotero **7.9.9–10.9.9**입니다.
이는 매니페스트에 선언된 설치 허용 범위이며, 전체 버전에서 테스트했다는 뜻은 아닙니다.
현재 직접 OAuth와 읽기 기능의 회귀 검증 환경은 **Linux / Zotero 10.0.6**이며,
Windows·macOS 및 지원 범위 전체의 동작을 보증하지는 않습니다.

## 사용하기

플러그인 설정에는 **번역 서비스·API 키·Config·원문/번역 언어·글자 크기·줄간격**과 제품 정보만 남겼습니다.
뷰어의 글자 크기 조작도 같은 설정을 저장하며, 글자 크기를 바꿔도 번역을 다시 요청하지 않습니다.
페이지 자동 번역과 원문 표시는 PDF 읽기 패널에서 조작합니다.

1. 번역 서비스와 언어를 선택합니다. 영어 논문을 한국어로 읽으려면 **English → Korean**으로 설정합니다.
2. 필요한 서비스 설정을 **Config**에서 입력하고 **Save**를 누릅니다.
3. **Translate**를 눌러 현재 페이지를 번역합니다.

| 기능                          | 동작                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| **Read page**                 | 현재 설정의 저장본이 있으면 불러오고, 없으면 번역합니다.                     |
| **Translate**                 | 저장본과 관계없이 새 번역을 요청합니다. 성공한 경우에만 저장본을 교체합니다. |
| **Auto**                      | 켜면 페이지 이동 시 번역합니다. 끄면 저장된 결과만 자동으로 불러옵니다.      |
| **Original**                  | 원문 표시를 켜거나 끕니다.                                                   |
| **Open in standalone window** | 별도의 읽기 창을 엽니다.                                                     |
| **Translate all**             | 문서를 순차 번역합니다. 완료된 저장본은 건너뛰며 도중에 취소할 수 있습니다.  |

읽기 도구 모음 첫 줄에는 **Auto·Original·글자 크기**, 둘째 줄에는 **Translate·Translate all**을 배치했습니다.
스위치는 색과 표시점으로 켜짐 상태를 나타내며, 좁은 화면에서는 겹치지 않도록 줄바꿈합니다.

번역한 페이지는 다른 논문을 읽었다 돌아오거나 Zotero를 재시작해도 자동으로 불러옵니다.
자동 번역을 켤 필요는 없습니다. PDF 내용이나 번역 서비스·언어·모델 등의 설정이 바뀌면
그 설정에 맞는 저장본을 사용하며, 저장본이 없을 때만 새 번역이 필요합니다.
현재는 PDF 수정 시각이나 API 키·로그인 상태 변경도 저장본 식별에 영향을 줍니다.
내용이 같아도 기존 저장본을 찾지 못할 수 있으며, 기존 저장 파일을 삭제하지는 않습니다.

## 번역 서비스

문장 번역 서비스는 아래 여덟 가지입니다. 단어 사전 기능은 별도로 유지됩니다.

| 서비스          | 연결 방식                                                   |
| --------------- | ----------------------------------------------------------- |
| **Google**      | 별도 API 키 없이 사용                                       |
| **Google(API)** | 별도 API 키 없이 사용                                       |
| **Bing**        | 별도 API 키 없이 사용                                       |
| **DeepLX**      | Config에서 요청 주소 설정                                   |
| **ChatGPT**     | API 키와 주소·모델 설정. OpenAI 호환 및 Anthropic 형식 지원 |
| **Claude**      | API 키와 Messages API 주소·모델 설정                        |
| **Gemini**      | API 키와 기본 API 주소·모델 설정                            |
| **OpenAI Auth** | 브라우저에서 ChatGPT 계정으로 로그인                        |

**ChatGPT와 OpenAI Auth는 다른 연결 방식입니다.**
ChatGPT 항목은 API 키를 사용하고, OpenAI Auth는 계정의 Codex 이용 권한과 한도를 사용합니다.
ChatGPT 구독이 일반 OpenAI API 크레딧을 제공하는 것은 아닙니다.

### ChatGPT 계정으로 연결

1. 서비스를 **OpenAI Auth**로 선택하고 **Config**를 엽니다.
2. **Sign in with ChatGPT**를 눌러 브라우저에서 로그인합니다.
3. 로그인 완료 후 설정 창에 모델 목록이 자동으로 표시됩니다.
4. **Model**과 **Reasoning effort**를 선택하고 **Save**를 누릅니다.

- **Automatic 모델**은 계정 카탈로그에서 우선순위가 가장 높은 사용 가능한 텍스트 모델을 선택합니다.
- **Default effort**는 요청에 추론 강도를 지정하지 않고 모델·서버 기본값을 따릅니다.
- effort 목록에는 선택한 모델이 지원한다고 알린 값만 표시합니다. 지원 정보가 없으면 Default만 제공합니다.
- 모델을 바꿔 기존 effort가 지원되지 않으면 현재 선택을 Default로 초기화합니다.
- 목록을 다시 불러오려면 **Check account and models**를 누릅니다.
- 로그인 중에는 **Cancel sign-in**, 로그인 후에는 **Sign out**으로 취소하거나 연결을 해제합니다.

별도 Codex 실행 파일이나 Node 설치는 필요하지 않습니다.
로그인에는 일시적으로 `localhost:1455`를 사용합니다. 포트가 사용 중이면 다른 로그인 작업을 종료한 뒤 다시 시도하세요.
비밀번호·토큰을 플러그인에 붙여 넣거나 다른 프로그램의 로그인 파일을 가져오지 않습니다.

### API 키로 연결

**ChatGPT · Claude · Gemini**는 선택한 서비스의 키 입력란에 API 키를 넣고,
**Config**에서 요청 주소와 모델을 설정합니다.

- **ChatGPT:** 사용하는 서버에 맞춰 API 형식을 선택합니다. OpenAI Chat Completions·Responses 또는 Anthropic 호환 형식을 사용할 수 있습니다.
- **Claude:** Messages API를 지원하는 기본 주소 또는 전체 요청 주소와 모델 ID를 설정합니다.
- **Gemini:** 기본 API 주소와 모델 ID를 각각 입력합니다. 기존에 모델까지 포함한 주소를 사용했다면 두 필드를 직접 확인하세요.

서비스별 이용 요금·호출 제한·호환성은 해당 제공자의 정책과 서버 구현에 따릅니다.

## 데이터와 주의사항

- 번역 대상 텍스트는 선택한 번역 서비스로 전송됩니다. 민감하거나 전송이 제한된 문서는 사용 전에 확인하세요.
- 페이지 번역 결과는 로컬에 저장됩니다. 명시적으로 다시 번역하면 새로운 요청을 보냅니다.
- OpenAI Auth 자격 증명은 Zotero의 **암호화된 로그인 관리자**에 저장합니다. 일반 API 키는 기존 플러그인 설정에 저장되므로 같은 보호 방식이 아닙니다.
- **Sign out**은 이 플러그인의 OAuth 자격 증명만 지웁니다. 다른 프로그램의 로그인은 변경하지 않습니다.
- OpenAI Auth는 로컬 에이전트를 실행하거나 모델에 파일 읽기·셸 도구를 제공하지 않습니다.
- 수식·그림·표 보존은 PDF 영역 렌더링 기능입니다. **OCR이나 LaTeX 복원이 아닙니다.**
- 복잡한 레이아웃·스캔 PDF·캡션·참고문헌은 정확히 인식되지 않을 수 있습니다. 번역과 읽기 순서는 원문과 함께 확인하세요.
- 계정·서비스 변경으로 연결이 중단될 수 있습니다. 개인 ChatGPT 계정의 실제 인증 번역은 개발 검증에 포함되지 않았습니다.

## 개발

Node와 npm은 개발·빌드할 때만 필요합니다. XPI를 설치하는 사용자는 필요하지 않습니다.

```bash
npm ci
npm run build
```

빌드 결과는 `build/zotero-translation-reader.xpi`입니다.

### 릴리스

1. `package.json`과 `package-lock.json`의 버전을 함께 올려 커밋하고 `main`에 푸시합니다.
2. 같은 버전의 태그를 만들어 푸시합니다(예: `v2.4.38`).
3. GitHub Actions가 네이티브 검증을 실행하고, 통과하면 XPI와 `SHA256SUMS.txt`를 포함한 GitHub 릴리스와
   안정/베타 업데이트 피드를 자동으로 게시합니다.

### 테스트

네이티브 회귀는 별도 테스트 프로필과 가상 계정·응답을 사용합니다.
데스크톱 환경에서 Zotero 실행 파일 경로를 지정해 실행합니다.

```bash
env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm run test:codex-quit
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm run test:reader-restart
```

Linux headless 환경의 메뉴 검증에는 Xvfb와 창 관리자가 필요합니다.
scaffold의 기본 `CI=1` 실행은 창 관리자 없이 Xvfb를 시작해 GTK 메뉴가 표시 전에 닫힐 수 있습니다.
GitHub Actions에서는 `GITHUB_ACTIONS`도 자식 테스트 프로세스에서 해제해, scaffold가 관리되지 않는 두 번째 디스플레이를 만들지 않도록 합니다.

```bash
xvfb-run -a sh -c 'xfwm4 --compositor=off & env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch'
```

`test:codex-quit`는 암호화 저장·로그아웃 도중 앱을 실제로 종료하고 외부 완료 기록을 확인합니다.
일반 테스트의 통과 개수와는 별도 검증입니다.
`test:reader-restart`는 같은 테스트 프로필을 두 번 실행해, 첫 실행에서 실제로 저장한 번역을
두 번째 Zotero 프로세스가 추가 번역 요청 없이 불러오는지 확인합니다.
scaffold 초기화를 고려해 첫 실행의 테스트 데이터·설정을 복원하며, 실제 사용자 프로필은 사용하지 않습니다.

버그는 [Issues](https://github.com/Kinetic27/zotero_paper_translate/issues)에 Zotero 버전·운영체제·재현 방법과 함께 남겨 주세요.
API 키, 토큰, 개인정보가 포함된 문서나 로그는 첨부하지 마세요.

## 라이선스

[AGPL-3.0-or-later](LICENSE)
