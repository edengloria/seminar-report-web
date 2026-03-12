# Seminar Report Web (GitHub Pages)

원본 세미나 녹음 파일을 업로드하면
- OpenAI STT로 전사
- 브라우저에서 기본 `3분(180초) 단위 + 12초 오버랩`으로 분할해 처리
  - 각 분할 조각은 OpenAI 오디오 API 용량 상한(약 25MB)에 맞춰 자동 보정
  - 분할 전사 병합 시 오버랩 구간의 근접 중복 문장을 후처리로 제거
  - STT 폴백 모델: `gpt-4o-transcribe` 실패 시 `whisper-1`로 자동 재시도(실제 사용 모델은 작업 패널에 표시)
  - 50MB 초과 파일은 업로드 거부(하드 제한)
- 요약 모델 선택
  - 기본: `gpt-5.2`
  - 후보: `gpt-5.2, gpt-5.2-codex, gpt-5.1, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, o4-mini`
  - 실패 시 목록 순서대로 자동 폴백
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
