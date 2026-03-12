# Seminar Report Web (GitHub Pages)

원본 세미나 녹음 파일을 업로드하면
- OpenAI STT(`gpt-4o-transcribe`)로 전사
  - 25MB 초과 파일은 브라우저에서 자동 분할 후 처리
  - 50MB 초과 파일은 업로드 거부(하드 제한)
- 세미나 보고서 구조화 요약(JSON schema)
- PDF/Markdown 생성 후 다운로드

를 브라우저 단에서 수행하는 정적 웹앱입니다.

## 핵심 보안 정책

- **OpenAI API Key는 코드/레포지토리에 절대 저장하지 않습니다.**
- 키는 폼에 입력한 즉시 브라우저 메모리에서만 사용되고, 페이지 새로고침 시 초기화됩니다.
- GitHub Pages는 정적 호스팅이므로 백엔드 비밀 보관은 불가합니다.

## 제공 기능

- 사용자 정보 입력: 이름, 학번, 날짜, OpenAI API Key
- 음성 파일 업로드 및 처리 큐 등록(현재 브라우저 기준)
- 대기 순위/진행률 바/실시간 콘솔 로그 표시
- 완료 시 PDF + Markdown 다운로드

## 확장자 지원

`.m4a`, `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.opus`, `.webm`, `.mp4`, `.mov`, `.m4v`, `.avi`, `.mkv`, `.3gp`, `.wma`, `.oga`, `.ogv`, `.mp4a`

> 브라우저 분할은 오디오를 디코딩 후 유효한 WAV 청크로 재생성해 STT 호출합니다.  
> OpenAI 오디오 API가 지원하지 않는 포맷은 브라우저 업로드 시 차단되거나 업로드 직후 오류가 납니다.

## 로컬 실행

```bash
python3 -m http.server 5173
# 또는
npx serve .
```

`index.html`을 브라우저로 열고 폼을 제출하세요.

## GitHub Pages 배포

이 저장소는 GitHub Actions로 배포됩니다.

1. 이 폴더를 새 레포로 생성 후 push
2. GitHub `Settings -> Pages`에서 Source를 `GitHub Actions`로 설정
3. `main` 브랜치 push 시 자동 배포

권장 배포 순서:
```bash
git init
git add .
git commit -m "feat: add seminar report web app"
git branch -M main
git remote add origin https://github.com/<your-github-id>/<repo-name>.git
git push -u origin main
```

배포 확인:
```bash
gh api repos/<your-github-id>/<repo-name>/pages | jq .html_url
```

## 주의

- 사용자 키는 브라우저에서 OpenAI로 직접 전송됩니다. 고수준 보안이 필요한 상용/대규모 다중 사용자 환경은
  별도 서버 또는 비밀 키 프록시가 필요합니다.

## 현재 처리 파이프라인

1. 오디오 업로드(브라우저)
2. 25MB 초과 시 자동 청킹 후 `gpt-4o-transcribe` 병렬/순차 전사
3. `Responses API`로 요약(JSON 스키마) + map/reduce 병렬 fallback
4. jsPDF로 PDF 생성 후 다운로드 링크 노출
5. Markdown도 동시에 생성해 선택 다운로드

## 출력 프리셋

제출 폼에서 출력 프리셋을 미리 선택할 수 있습니다.

- `classic` : 기본 정갈형 (기본값)
- `compact` : 짧고 조밀한 형식
- `academic` : 아카데믹 보고서형 (Source Notes 강조)
