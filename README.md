<p align="center">
  <img src="addon/chrome/content/icons/favicon.svg" width="96" height="96" alt="Zotero Translation Reader" />
</p>

# Zotero Translation Reader

[한국어](README.md) · [English](README.en.md)

Zotero에서 논문을 읽다가 필요한 페이지를 번역할 수 있습니다. 수식·그림·표는 PDF 원본으로 보여줍니다.

<p align="center">
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest"><img src="https://img.shields.io/github/v/release/Kinetic27/zotero_paper_translate?label=latest%20release&color=blue" alt="Latest release" /></a>
  <a href="https://github.com/Kinetic27/zotero_paper_translate/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Kinetic27/zotero_paper_translate/test.yml?label=tests" alt="Test workflow status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="AGPL-3.0-or-later" /></a>
</p>

<p align="center">
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest/download/zotero-translation-reader.xpi"><strong>최신 XPI 다운로드</strong></a>
  ·
  <a href="https://github.com/Kinetic27/zotero_paper_translate/releases/latest">Releases</a>
  ·
  <a href="https://github.com/Kinetic27/zotero_paper_translate/issues">Issues</a>
</p>

## 주요 기능

- 현재 페이지를 번역하거나, 페이지를 넘길 때 자동으로 번역합니다.
- 인식한 수식·그림·표는 PDF 원본으로 보여줍니다. 문장 안의 인라인 수식도 번역문 사이에 표시합니다.
- 페이지 끝에서 문단이 끊기면 다음 페이지로 이어지는 내용을 참고해 번역합니다.
- 성공한 번역은 로컬에 저장합니다. 같은 페이지를 다시 열면 저장본을 재사용합니다.
- 번역문만 읽거나 원문을 함께 표시할 수 있습니다. 별도 읽기 창도 있습니다.
- 문서 전체를 페이지 순서대로 번역합니다. 도중에 취소할 수 있습니다.
- ChatGPT 계정은 브라우저 OAuth로 연결합니다. 로그인 후 모델과 reasoning effort를 고릅니다.

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

## 사용하기

설정에서 번역 서비스, API 키, 원문·번역 언어와 글자 크기·줄간격을 바꿉니다.
서비스별 설정은 **Config**에서 열고, 제품 정보도 설정 창에서 확인할 수 있습니다.

뷰어의 글자 크기 조작도 같은 설정에 저장됩니다. 크기를 바꿔도 번역을 다시 요청하지는 않습니다.
자동 번역과 원문 표시는 PDF 읽기 패널에서 켜거나 끕니다.

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

도구 모음 첫 줄은 **Auto·Original·글자 크기**, 둘째 줄은 **Translate·Translate all**입니다.
켜진 스위치에는 색과 표시점이 나타납니다. 화면이 좁으면 조작 버튼은 겹치는 대신 다음 줄로 내려갑니다.

다른 논문을 읽었다 돌아오거나 Zotero를 재시작해도 저장한 번역을 불러옵니다. Auto는 꺼 두어도 됩니다.
PDF 내용, 번역 서비스, 언어, 모델 등이 바뀌면 바뀐 설정에 맞는 저장본을 찾습니다.
그 저장본이 없을 때는 새 번역이 필요합니다.

PDF 수정 시각과 API 키·로그인 상태도 저장본을 구분하는 데 쓰입니다.
따라서 내용이 같아도 예전 번역을 찾지 못할 수 있습니다. 기존 저장 파일을 지우는 것은 아닙니다.

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

**ChatGPT**는 API 키로 연결합니다. **OpenAI Auth**는 ChatGPT 계정의 Codex 이용 권한과 한도를 사용합니다.
ChatGPT 구독이 일반 OpenAI API 크레딧을 제공하는 것은 아닙니다.

### ChatGPT 계정으로 연결

1. 서비스를 **OpenAI Auth**로 선택하고 **Config**를 엽니다.
2. **Sign in with ChatGPT**를 눌러 브라우저에서 로그인합니다.
3. 로그인 완료 후 설정 창에 모델 목록이 자동으로 표시됩니다.
4. **Model**과 **Reasoning effort**를 선택하고 **Save**를 누릅니다.

Model을 **Automatic**으로 두면 계정 카탈로그에서 사용 가능한 텍스트 모델 중 우선순위가 가장 높은 모델을 고릅니다.
Reasoning effort의 **Default**는 추론 강도를 따로 지정하지 않고 모델·서버 기본값을 따릅니다.

effort 목록에는 선택한 모델이 지원한다고 알린 값만 나옵니다. 지원 정보가 없으면 Default만 표시합니다.
모델을 바꾼 뒤 기존 effort를 사용할 수 없으면 선택값을 Default로 돌립니다.
목록은 **Check account and models**로 다시 불러올 수 있습니다.
로그인 도중에는 **Cancel sign-in**으로 취소하고, 로그인한 뒤에는 **Sign out**으로 연결을 해제합니다.

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
- OpenAI Auth 자격 증명은 Zotero의 **암호화된 로그인 관리자**에 저장합니다. 일반 API 키는 플러그인 설정에 저장하므로 같은 방식으로 보호하지는 않습니다.
- **Sign out**은 이 플러그인의 OAuth 자격 증명만 지웁니다. 다른 프로그램의 로그인은 변경하지 않습니다.
- OpenAI Auth는 로컬 에이전트를 실행하거나 모델에 파일 읽기·셸 도구를 제공하지 않습니다.
- 수식·그림·표 보존은 PDF 영역 렌더링 기능입니다. **OCR이나 LaTeX 복원이 아닙니다.**
- 복잡한 레이아웃·스캔 PDF·캡션·참고문헌은 정확히 인식되지 않을 수 있습니다. 번역과 읽기 순서는 원문과 함께 확인하세요.
- 계정·서비스 변경으로 연결이 중단될 수 있습니다. 개인 ChatGPT 계정의 실제 인증 번역은 개발 검증에 포함되지 않았습니다.

## 개발

Node와 npm은 개발·빌드할 때만 필요합니다. XPI로 설치할 때는 둘 다 필요 없습니다.

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

Linux headless 환경에서 메뉴를 검증하려면 Xvfb와 창 관리자가 필요합니다.
scaffold는 `CI=1`이면 창 관리자 없이 Xvfb를 띄웁니다. 이때 GTK 메뉴가 표시되기도 전에 닫힐 수 있습니다.
GitHub Actions에서도 아래처럼 자식 테스트 프로세스의 `CI`와 `GITHUB_ACTIONS`를 해제해야,
scaffold가 두 번째 Xvfb를 띄우지 않고 이미 준비한 디스플레이를 사용합니다.

```bash
xvfb-run -a sh -c 'xfwm4 --compositor=off & env -u CI -u GITHUB_ACTIONS ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero npm test -- --no-watch'
```

`test:codex-quit`는 암호화 저장·로그아웃 도중 앱을 종료합니다. 종료 후 외부에 남긴 완료 기록으로 결과를 확인합니다.
일반 테스트의 통과 개수에는 포함하지 않습니다.

`test:reader-restart`는 같은 테스트 프로필로 Zotero를 두 번 실행합니다.
첫 실행에서 저장한 번역을 두 번째 프로세스가 추가 번역 요청 없이 불러오는지 확인하는 테스트입니다.
scaffold가 디렉터리를 초기화하므로 첫 실행의 테스트 데이터와 설정을 복원해서 사용합니다. 실제 사용자 프로필은 건드리지 않습니다.

버그는 [Issues](https://github.com/Kinetic27/zotero_paper_translate/issues)에 Zotero 버전·운영체제·재현 방법과 함께 남겨 주세요.
API 키, 토큰, 개인정보가 포함된 문서나 로그는 첨부하지 마세요.

## 라이선스

[AGPL-3.0-or-later](LICENSE)
