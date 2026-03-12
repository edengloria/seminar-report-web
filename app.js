const STT_MODEL = "gpt-4o-transcribe";
const SUMMARY_MODELS = ["gpt-4o", "gpt-4o-mini"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const STT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const STT_SEGMENT_BYTES = 18 * 1024 * 1024;
const STT_MIN_SEGMENT_BYTES = 4 * 1024 * 1024;
const POLL_MS = 1000;
const TRANSCRIBE_REQUEST_TIMEOUT_MS = 7 * 60 * 1000;
const TRANSCRIBE_RETRY_LIMIT = 3;
const STT_RETRY_INTERVAL_MS = 1200;
const ALLOWED_EXTENSIONS = ["m4a", "mp3", "wav", "ogg", "flac", "aac", "opus", "webm", "mp4", "mov", "m4v", "avi", "mkv", "3gp", "oga", "ogv", "wma", "mp4a"];

const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title_topic", "summary_sentences", "learning_sentence", "qna", "source_span_notes"],
  properties: {
    title_topic: { type: "string", minLength: 4 },
    summary_sentences: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string", minLength: 10 },
    },
    learning_sentence: { type: "string", minLength: 10 },
    qna: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string", minLength: 8 },
          answer: { type: "string", minLength: 8 },
        },
      },
    },
    source_span_notes: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
};

const OUTPUT_PRESETS = {
  classic: {
    id: "classic",
    label: "클래식",
    description: "명확한 항목 구분과 표준 가독성 중심",
    mdTemplate: "classic",
    pdf: {
      font: "helvetica",
      titleSize: 15,
      headingSize: 12,
      bodySize: 10.2,
      lineHeight: 1.35,
      margin: 14,
      maxWidth: 182,
      dividerColor: 220,
      headingPrefix: "1.",
    },
  },
  compact: {
    id: "compact",
    label: "컴팩트",
    description: "짧고 조밀한 형식, PDF는 여백 축소",
    mdTemplate: "compact",
    pdf: {
      font: "courier",
      titleSize: 13.5,
      headingSize: 11.4,
      bodySize: 9.4,
      lineHeight: 1.22,
      margin: 11,
      maxWidth: 188,
      dividerColor: 190,
      headingPrefix: "Ⅰ",
    },
  },
  academic: {
    id: "academic",
    label: "아카데믹",
    description: "학술 보고서 톤, 타임라인/주석 강조",
    mdTemplate: "academic",
    pdf: {
      font: "times",
      titleSize: 16.5,
      headingSize: 12.5,
      bodySize: 10.1,
      lineHeight: 1.35,
      margin: 16,
      maxWidth: 178,
      dividerColor: 140,
      headingPrefix: "Ⅰ",
    },
  },
};

function getOutputPreset(presetId) {
  return OUTPUT_PRESETS[presetId] || OUTPUT_PRESETS.classic;
}

const mapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary_points", "learning_candidates", "qna_candidates", "source_span_notes"],
  properties: {
    summary_points: { type: "array", items: { type: "string" }, maxItems: 6 },
    learning_candidates: { type: "array", items: { type: "string" }, maxItems: 4 },
    qna_candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
      maxItems: 6,
    },
    source_span_notes: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
};

const appState = {
  jobs: [],
  activeJobId: null,
  apiKey: "",
  startedAt: new Map(),
  progressTimer: null,
};

const form = document.getElementById("submit-form");
const jobsList = document.getElementById("jobs-list");
const liveTitle = document.getElementById("live-title");
const liveProgress = document.getElementById("live-progress");
const liveMeta = document.getElementById("live-meta");
const liveConsole = document.getElementById("live-console");
const formError = document.getElementById("form-error");

form.addEventListener("submit", onSubmit);
document.getElementById("clear-form-btn").addEventListener("click", () => {
  form.reset();
  formError.textContent = "";
});

render();
startLiveTicker();

async function onSubmit(event) {
  event.preventDefault();
  formError.textContent = "";
  const name = String(document.getElementById("student-name").value || "").trim();
  const studentId = String(document.getElementById("student-id").value || "").trim();
  const date = String(document.getElementById("seminar-date").value || "").trim();
  const apiKey = String(document.getElementById("openai-key").value || "").trim();
  const outputPresetId = String(document.getElementById("output-preset").value || "classic").trim();
  const fileInput = document.getElementById("audio-file");
  const file = fileInput.files[0];

  if (!name || !studentId || !date || !apiKey || !file) {
    formError.textContent = "모든 항목을 입력해 주세요.";
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    formError.textContent = `파일 크기가 너무 큽니다. (${Math.round(file.size / (1024 * 1024))}MB). 50MB 이내로 업로드해 주세요.`;
    return;
  }
  const fileName = String(file.name || "").toLowerCase();
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    formError.textContent = `지원되지 않는 파일 형식입니다. 확장자 .${ext || "미확인"}은(는) 처리할 수 없습니다.`;
    return;
  }
  if (file.type && !file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
    formError.textContent = "오디오/비디오 MIME 타입이 확인되지 않습니다. 다른 파일을 선택해 주세요.";
    return;
  }

  appState.apiKey = apiKey;

  const job = {
    id: `job_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    studentName: name,
    studentId,
    seminarDate: date,
    outputPresetId: getOutputPreset(outputPresetId).id,
    fileName: file.name,
    file,
    status: "queued",
    progress: 0,
    progressTarget: 0,
    progressDetail: "",
    stage: "대기 중",
    logs: [makeLog("INFO", "job created")],
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
    output: {},
    lastLogAt: null,
    stallNoticeAt: null,
  };
  appState.jobs.push(job);
  form.reset();
  render();
  logJob(job.id, "INFO", "submit: queued");
  if (!appState.activeJobId) {
    void processQueue();
  }
}

function makeLog(level, message) {
  return {
    time: new Date().toLocaleTimeString(),
    level: String(level || "INFO").toUpperCase(),
    message: String(message || ""),
  };
}

function parseLogLine(line) {
  if (line && typeof line === "object") {
    const safeLine = line;
    return {
      time: String(safeLine.time || "").trim(),
      level: String(safeLine.level || "INFO").toLowerCase(),
      message: String(safeLine.message || "").trim(),
    };
  }

  const safe = String(line || "");
  const match = safe.match(/^(.+?)\s*\[([^\]]+)\]\s*(.*)$/);
  if (!match) {
    return {
      time: "",
      level: "INFO",
      message: safe,
    };
  }
  return {
    time: match[1],
    level: String(match[2] || "INFO").toLowerCase(),
    message: match[3] || "",
  };
}

function withTimeout(promise, ms, label = "request") {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

function renderLogTimeline(container, lines, defaultClass = "console-empty") {
  container.innerHTML = "";
  container.classList.remove("console-empty");
  container.classList.add("console");
  container.classList.add("console-timeline");

  if (!Array.isArray(lines) || lines.length === 0) {
    container.textContent = "로그가 아직 없습니다.";
    if (defaultClass) {
      container.classList.add(defaultClass);
    }
    return;
  }

  const list = document.createElement("div");
  for (const line of lines) {
    const parsed = parseLogLine(line);
    const row = document.createElement("div");
    row.className = "log-item";

    const time = document.createElement("div");
    time.className = "log-item-time";
    time.textContent = parsed.time;

    const level = document.createElement("div");
    const levelClass = parsed.level.toLowerCase();
    level.className = `log-item-level ${["warn", "error", "info"].includes(levelClass) ? levelClass : ""}`;
    level.textContent = parsed.level.toUpperCase();

    const message = document.createElement("div");
    message.className = "log-item-message";
    message.textContent = parsed.message;

    row.appendChild(time);
    row.appendChild(level);
    row.appendChild(message);
    list.appendChild(row);
  }
  container.appendChild(list);
}

function logJob(jobId, level, message) {
  const job = appState.jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.logs.push(makeLog(level, message));
  if (job.logs.length > 200) job.logs.shift();
  job.lastLogAt = Date.now();
  job.stallNoticeAt = null;
  if (appState.activeJobId === jobId) {
    renderLiveConsole();
  }
  renderJobs();
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function queuePosition(jobId) {
  const queued = appState.jobs.filter((j) => j.status === "queued");
  const idx = queued.findIndex((j) => j.id === jobId);
  return idx === -1 ? null : idx + 1;
}

function setStatus(jobId, status, stage, progress, detail) {
  const job = appState.jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.status = status;
  if (typeof stage === "string") job.stage = stage;
  if (typeof progress === "number") {
    job.progressTarget = Math.max(0, Math.min(100, progress));
  }
  job.lastLogAt = Date.now();
  job.stallNoticeAt = null;
  if (typeof detail !== "undefined") {
    job.progressDetail = String(detail || "").trim();
  }
  if (status === "processing" && !job.startedAt) {
    job.startedAt = new Date().toISOString();
  }
  if (status === "done" || status === "error") {
    job.finishedAt = new Date().toISOString();
  }
  if (status !== "processing") {
    job.startedAt = job.startedAt || null;
  }
  render();
}

async function processQueue() {
  if (appState.activeJobId) return;
  const next = appState.jobs.find((j) => j.status === "queued");
  if (!next) {
    appState.activeJobId = null;
    render();
    return;
  }

  appState.activeJobId = next.id;
  setStatus(next.id, "processing", "전처리/인덱싱", 2, "큐에서 실행 대기 진입");
  logJob(next.id, "INFO", "processing started");

  try {
    const transcript = await transcribeAudio(next);
    next.output.transcript = transcript;
    setStatus(next.id, "processing", "요약 생성", 45, "요약 텍스트 정합성 검사");

    const report = await summarizeTranscript(next, transcript);
    next.output.report = report;
    setStatus(next.id, "processing", "PDF 렌더링", 78, "PDF 레이아웃 구성");

    const pdf = await renderReportPdf(next, report, next.outputPresetId);
    next.output.pdf = pdf;
    next.output.md = toMarkdownReport(next, report, next.outputPresetId);

    setStatus(next.id, "done", "완료", 100, "완료");
    logJob(next.id, "INFO", "job finished");
  } catch (error) {
    setStatus(next.id, "error", "실패", next.progress || 0, "오류");
    next.error = String(error?.message || error);
    logJob(next.id, "ERROR", `error: ${next.error}`);
  } finally {
    appState.activeJobId = null;
    next.progress = Math.max(next.progress, next.status === "done" ? 100 : next.progress);
    render();
    if (appState.jobs.some((j) => j.status === "queued")) {
      setTimeout(() => void processQueue(), 250);
    }
  }
}

function renderJobLogSummary(container, lines, maxLines = 4) {
  container.innerHTML = "";
  container.className = "job-log-summary";

  if (!Array.isArray(lines) || lines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "최근 로그가 아직 없습니다.";
    container.appendChild(empty);
    return;
  }

  const recent = lines.slice(-maxLines);
  for (const raw of recent) {
    const parsed = parseLogLine(raw);
    const line = document.createElement("div");
    line.className = "summary-line";
    const levelTag = parsed.level ? `[${String(parsed.level).toUpperCase()}]` : "";
    const time = parsed.time ? `${parsed.time} ` : "";
    line.textContent = `${time}${levelTag} ${parsed.message || ""}`.trim();
    container.appendChild(line);
  }
}

async function transcribeAudio(job) {
  setStatus(job.id, "processing", "Whisper 전사 중", 5, "시작");
  const apiKey = appState.apiKey;
  if (!apiKey) throw new Error("API key missing");

  if (job.file.size <= STT_MAX_FILE_SIZE) {
    logJob(job.id, "INFO", `single pass 전사 시작: ${formatBytes(job.file.size)} (임계값 ${formatBytes(STT_MAX_FILE_SIZE)})`);
    const single = await transcribeChunkWithAutoRetry(apiKey, job.id, job.file, 0, STT_SEGMENT_BYTES);
    logJob(job.id, "INFO", "transcription completed without split");
    setStatus(job.id, "processing", "요약으로 텍스트 정리", 35, "단일 청크 완결");
    return single.text;
  }

  logJob(
    job.id,
    "INFO",
    `파일 크기 ${Math.round(job.file.size / (1024 * 1024))}MB: STT 분할 모드로 처리합니다. (기준 ${Math.round(STT_MAX_FILE_SIZE / (1024 * 1024))}MB)`
  );
  const segments = await splitAudioForStt(job.file, STT_SEGMENT_BYTES);
  if (!segments.length) {
    throw new Error("Failed to split audio into valid chunks");
  }
  logJob(job.id, "INFO", `초기 오디오 분할 완료: ${segments.length}개 조각`);

  const combinedTextParts = [];
  const combinedSegments = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const progress = 5 + Math.round((30 * (i + 1)) / segments.length);
    setStatus(job.id, "processing", "Whisper 전사 중", progress, `분할 ${i + 1}/${segments.length}`);
    const result = await transcribeChunkWithAutoRetry(
      apiKey,
      job.id,
      segment.blob,
      segment.startTimeSec,
      STT_SEGMENT_BYTES
    );
    if (result.text) {
      combinedTextParts.push(result.text);
    }
    if (Array.isArray(result.segments) && result.segments.length > 0) {
      combinedSegments.push(...result.segments);
    } else if (result.text) {
      combinedSegments.push({
        start: segment.startTimeSec,
        end: segment.endTimeSec || segment.startTimeSec,
        text: result.text,
      });
    }
    logJob(job.id, "INFO", `transcribe segment ${i + 1}/${segments.length} done`);
  }

  const mergedText = combinedTextParts.join("\n").trim();
  if (!mergedText) {
    throw new Error("transcription failed");
  }

  logJob(
    job.id,
    "INFO",
    `transcription completed with ${segments.length} chunks · timestamp aligned entries: ${combinedSegments.length}`
  );
  setStatus(job.id, "processing", "요약으로 텍스트 정리", 35, "분할 전사 병합");
  job.output.transcriptAligned = combinedSegments;
  return mergedText;
}

async function transcribeSingleFile(file, apiKey, timeOffsetSec = 0) {
  const model = STT_MODEL;
  const formats = model.includes("gpt-4o") ? ["json", "text"] : ["verbose_json", "json", "text"];
  let lastError = null;
  for (const responseFormat of formats) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("model", model);
      formData.append("response_format", responseFormat);
      const res = await withTimeout(
        fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        }),
        TRANSCRIBE_REQUEST_TIMEOUT_MS,
        "transcribe"
      );
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`OpenAI audio API ${res.status}: ${body}`);
        lastError = err;
        if (!body.includes("unsupported") && !body.includes("unsupported_value")) {
          throw err;
        }
        if (responseFormat !== "text") {
          logJob(appState.activeJobId, "WARN", `${responseFormat} 포맷 미지원 또는 오류 -> fallback`);
          continue;
        }
        throw err;
      }

      if (responseFormat === "text") {
        const text = (await res.text()).trim();
        return { text, segments: [{ start: timeOffsetSec, end: timeOffsetSec, text }] };
      }

      const payload = await res.json();
      return extractTranscriptFromPayload(payload, timeOffsetSec);
    } catch (error) {
      lastError = error;
      if (responseFormat !== "text") {
        logJob(appState.activeJobId, "WARN", `${responseFormat} 포맷 실패 -> 재시도`);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("transcription failed");
}

async function transcribeChunkWithAutoRetry(apiKey, jobId, file, timeOffsetSec = 0, targetBytes = STT_SEGMENT_BYTES) {
  if (!file || !file.size) {
    throw new Error("audio chunk is empty");
  }
  const job = appState.jobs.find((j) => j.id === jobId);
  const jobLabel = file.size ? `(${Math.round(file.size / (1024 * 1024))}MB)` : "";
  const chunkStart = Date.now();
  try {
    const presetLabel = job ? ` [${job.outputPresetId || "N/A"}]` : "";
    const attemptLabel = targetBytes ? ` target ${Math.round(targetBytes / (1024 * 1024))}MB` : "";
    logJob(jobId, "INFO", `transcribe attempt${presetLabel} ${jobLabel}${attemptLabel}`);
    return await transcribeSingleFile(file, apiKey, timeOffsetSec);
  } catch (error) {
    const message = String(error?.message || error);
    const detailSec = ((Date.now() - chunkStart) / 1000).toFixed(1);
    if (message.includes("timed out")) {
      if (job && !job.stallNoticeAt) {
        job.stallNoticeAt = Date.now();
        setStatus(jobId, "processing", "Whisper 전사 중", job.progressTarget || 35, "타임아웃 재시도");
        logJob(jobId, "WARN", `transcribe timeout (${detailSec}s): ${message}`);
      }
      return withBackoffRetry(() => transcribeSingleFile(file, apiKey, timeOffsetSec), jobId, 1);
    }
    if (isTransientTranscribeError(message)) {
      if (job) {
        setStatus(jobId, "processing", "Whisper 전사 중", job.progressTarget || 35, `일시적 오류 재시도 (소요 ${detailSec}s)`);
        logJob(jobId, "WARN", `transcribe temporary failure (${detailSec}s), retrying: ${message}`);
      }
      return withBackoffRetry(() => transcribeSingleFile(file, apiKey, timeOffsetSec), jobId, 1);
    }
    if (!isOpenAITooLargeError(message) || targetBytes <= STT_MIN_SEGMENT_BYTES || file.size <= STT_MIN_SEGMENT_BYTES) {
      throw error;
    }

    const nextTarget = Math.max(STT_MIN_SEGMENT_BYTES, Math.floor(targetBytes * 0.7));
    if (job) {
      setStatus(
        jobId,
        "processing",
        "Whisper 전사 중",
        job.progressTarget || 35,
        `재시도: 조각 ${Math.round(file.size / (1024 * 1024))}MB → ${Math.round(nextTarget / (1024 * 1024))}MB`
      );
      logJob(
        jobId,
        "WARN",
        `transcribe chunk too large (${Math.round(file.size / (1024 * 1024))}MB): ${Math.round(targetBytes / (1024 * 1024))}MB -> ${Math.round(nextTarget / (1024 * 1024))}MB`
      );
    }
    logJob(jobId, "WARN", `세그먼트 분할 재시도: ${Math.round(targetBytes / (1024 * 1024))}MB -> ${Math.round(nextTarget / (1024 * 1024))}MB`);
    const chunks = await splitAudioForStt(file, nextTarget);
    if (!chunks.length) {
      throw error;
    }

    const merged = {
      text: "",
      segments: [],
    };
    const textParts = [];
    for (const chunk of chunks) {
      const chunkResult = await transcribeChunkWithAutoRetry(
        apiKey,
        jobId,
        chunk.blob,
        timeOffsetSec + chunk.startTimeSec,
        nextTarget
      );
      if (chunkResult.text) {
        textParts.push(chunkResult.text);
      }
      if (Array.isArray(chunkResult.segments) && chunkResult.segments.length > 0) {
        merged.segments.push(...chunkResult.segments);
      }
    }
    merged.text = textParts.join("\n").trim();
    return merged;
  }
}

async function withBackoffRetry(fn, jobId, attempt = 1) {
  if (attempt > TRANSCRIBE_RETRY_LIMIT) {
    throw new Error("transcribe retries exceeded");
  }

  await sleep(STT_RETRY_INTERVAL_MS * attempt);
  if (jobId && appState.activeJobId === jobId) {
    const job = appState.jobs.find((j) => j.id === jobId);
    if (job) {
      setStatus(jobId, "processing", "Whisper 전사 중", job.progressTarget || 35, `재시도 ${attempt}/${TRANSCRIBE_RETRY_LIMIT}`);
      logJob(jobId, "WARN", `transcribe 재시도 ${attempt}/${TRANSCRIBE_RETRY_LIMIT} 시작`);
    }
  }

  try {
    return await withTimeout(fn(), TRANSCRIBE_REQUEST_TIMEOUT_MS, "transcribe");
  } catch (error) {
    if (attempt >= TRANSCRIBE_RETRY_LIMIT) throw error;
    if (jobId) {
      const job = appState.jobs.find((j) => j.id === jobId);
      setStatus(
        jobId,
        "processing",
        "Whisper 전사 중",
        job?.progressTarget || 35,
        `재시도 ${attempt}/${TRANSCRIBE_RETRY_LIMIT}`
      );
    }
    return withBackoffRetry(fn, jobId, attempt + 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpenAITooLargeError(message = "") {
  return /25\s*MB|too\s+large|maximum\s+file\s+size|file\s+size|max\s*size|exceeds\s*(?:the\s*)?maximum|payload|권장\s*상한|413/i.test(
    message
  );
}

function isTransientTranscribeError(message = "") {
  return /timed out|network|5\d{2}|429|rate\s*limit|temporarily|service\s+unavailable|bad\s+gateway|gateway\s*timeout/i.test(
    message
  );
}

function extractTranscriptFromPayload(payload, timeOffsetSec = 0) {
  if (!payload) return { text: "", segments: [] };
  const startOffset = Number(timeOffsetSec) || 0;
  const text = typeof payload.text === "string" && payload.text.trim() ? payload.text.trim() : "";
  const segments = [];
  if (Array.isArray(payload.segments)) {
    for (const segment of payload.segments) {
      const segText = String(segment?.text || "").trim();
      if (!segText) continue;
      const rawStart = Number(segment?.start);
      const rawEnd = Number(segment?.end);
      segments.push({
        start: Number.isFinite(rawStart) ? startOffset + rawStart : startOffset,
        end: Number.isFinite(rawEnd) ? startOffset + rawEnd : startOffset,
        text: segText,
      });
    }
  }
  if (segments.length > 0 && text) {
    return { text, segments };
  }
  if (Array.isArray(payload.segments)) {
    return {
      text: payload.segments
        .map((segment) => segment?.text || "")
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      segments: [],
    };
  }
  if (Array.isArray(payload.words)) {
    const wordSegments = [];
    for (const w of payload.words) {
      const wText = String(w?.word || "").trim();
      if (!wText) continue;
      const rawStart = Number(w?.start);
      const rawEnd = Number(w?.end);
      wordSegments.push({
        start: Number.isFinite(rawStart) ? startOffset + rawStart : startOffset,
        end: Number.isFinite(rawEnd) ? startOffset + rawEnd : startOffset,
        text: wText,
      });
    }
    return {
      text: payload.words
        .map((w) => w.word || "")
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      segments: wordSegments,
    };
  }
  return { text: "", segments: [] };
}

async function splitAudioForStt(file, targetBytes) {
  const fileData = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error("브라우저에서 AudioContext를 지원하지 않습니다.");
  const audioCtx = new AudioCtx();
  let decoded;

  try {
    decoded = await audioCtx.decodeAudioData(fileData);
  } catch (error) {
    await audioCtx.close().catch(() => {});
    throw new Error(`오디오 디코딩 실패: ${String(error?.message || error)}`);
  }

  try {
    const channels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const totalSamples = decoded.length;
    const minChunkCountByFileSize = Math.max(1, Math.ceil(file.size / STT_MAX_FILE_SIZE));
    const maxSamplesBySize = Math.max(
      1,
      Math.floor((sampleRate * Math.max(targetBytes - 44, 0)) / Math.max(channels * 2, 1))
    );
    const maxSamplesByFileSize = Math.floor(totalSamples / Math.max(1, minChunkCountByFileSize));
    const maxSamplesPerChunk = Math.max(1, Math.min(maxSamplesBySize, maxSamplesByFileSize));
    const chunks = [];
    const projectedChunkCount = Math.max(1, Math.ceil(totalSamples / maxSamplesPerChunk));
    const chunkLabel = `${(file.size / (1024 * 1024)).toFixed(1)}MB`;
    logJob(
      appState.activeJobId,
      "INFO",
      `오디오 분할: ${chunkLabel} 소스 / 청크타입 ${Math.round(targetBytes / (1024 * 1024))}MB → ${projectedChunkCount}개 보장`
    );

    let cursor = 0;
    while (cursor < totalSamples) {
      const end = Math.min(totalSamples, cursor + maxSamplesPerChunk);
      const chunkLen = end - cursor;
      const segmentBuffer = audioCtx.createBuffer(channels, chunkLen, sampleRate);
      for (let ch = 0; ch < channels; ch++) {
        const source = decoded.getChannelData(ch);
        const target = segmentBuffer.getChannelData(ch);
        target.set(source.subarray(cursor, end), 0);
      }

      const wav = encodeWavFromAudioBuffer(segmentBuffer);
      chunks.push({
        blob: new Blob([wav], { type: "audio/wav" }),
        startTimeSec: cursor / sampleRate,
        endTimeSec: end / sampleRate,
      });
      cursor = end;
    }

    return chunks;
  } finally {
    await audioCtx.close().catch(() => {});
  }
}

function encodeWavFromAudioBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let pos = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(c)[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, int16, true);
      pos += 2;
    }
  }
  return buffer;
}

async function summarizeTranscript(job, transcriptText) {
  const apiKey = appState.apiKey;
  if (!transcriptText || !apiKey) throw new Error("No transcript text");

  const language = "en";
  const safeLang = language === "ko" ? "Korean" : "English";
  const tokenEstimate = Math.max(1, Math.round(transcriptText.length / 3));

  if (tokenEstimate <= 300_000) {
    const result = await callResponsesWithModelFallback(
      apiKey,
      "seminar_report",
      {
        type: "json_schema",
        name: "seminar_report",
        schema: reportSchema,
        strict: true,
      },
      buildReportDeveloperPrompt(language),
      buildSinglePassPrompt(transcriptText, job, language),
      2500
    );
    return result.payload;
  }

  const chunks = chunkForSummary(transcriptText, 28000, 7000);
  const mapResults = [];
  for (let index = 0; index < chunks.length; index++) {
    setStatus(
      job.id,
      "processing",
      "요약 중",
      45 + Math.round((35 * (index + 1)) / (chunks.length * 2)),
      `map ${index + 1}/${chunks.length}`
    );
    const prompt = `Seminar date: ${job.seminarDate}\nDesired language: ${safeLang}\n\nChunk ${index + 1}/${chunks.length}\n\n${chunks[index]}`;
    const result = await callResponsesWithModelFallback(
      apiKey,
      "seminar_chunk_summary",
      {
        type: "json_schema",
        name: "seminar_chunk_summary",
        schema: mapSchema,
        strict: true,
      },
      buildMapDeveloperPrompt(language),
      prompt,
      1800
    );
    mapResults.push(result.payload);
  }

  const reducePrompt = `Seminar date: ${job.seminarDate}\nDesired language: ${safeLang}\n\nCombine the following chunk summaries into the final seminar report.\n\n${JSON.stringify(
    mapResults,
    null,
    2
  )}`;
  const finalResult = await callResponsesWithModelFallback(
    apiKey,
    "seminar_report_reduce",
    {
      type: "json_schema",
      name: "seminar_report_reduce",
      schema: reportSchema,
      strict: true,
    },
    buildReduceDeveloperPrompt(language),
    reducePrompt,
    2200
  );
  return finalResult.payload;
}

function extractQnaHint(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const candidates = lines.filter((line) => line.includes("?") || /\?$/.test(line) || /\?/.test(line));
  const total = lines.length;
  const tailStart = Math.floor(total * 0.72);
  const merged = candidates.concat(lines.slice(tailStart)).filter(Boolean);
  const selected = [...new Set(merged)].slice(-60);
  return selected.join("\n");
}

function buildSinglePassPrompt(transcriptText, job, language) {
  return [
    `Seminar date: ${job.seminarDate}`,
    `Desired language: ${language}`,
    "Transcript follows. Use the full transcript as the primary source.",
    "",
    "[QnA candidate excerpt]",
    extractQnaHint(transcriptText).slice(0, 16000),
    "",
    "[Full transcript]",
    transcriptText,
  ].join("\n");
}

function buildReportDeveloperPrompt(language) {
  const lang = language === "ko" ? "Korean" : "English";
  return [
    "You convert a seminar transcript into a one-page seminar report scaffold.",
    "Return only valid JSON matching the schema.",
    `Write the result in ${lang}.`,
    "If the transcript mixes English and Korean, translate or normalize everything into the requested output language.",
    "Requirements:",
    "- Summary must contain exactly 3 sentences.",
    "- Learning must be exactly 1 sentence.",
    "- QnA must contain exactly 3 distinct student question/answer pairs.",
    "- Prefer the later QnA section when extracting questions.",
    "- Do not invent details not supported by the transcript.",
    "- Keep the wording concise enough to fit on one A4 page.",
  ].join("\n");
}

function buildMapDeveloperPrompt(language) {
  const lang = language === "ko" ? "Korean" : "English";
  return [
    "You extract concise evidence from one transcript chunk.",
    "Return only valid JSON matching the schema.",
    `Write all strings in ${lang}.`,
    "If the transcript mixes English and Korean, normalize all extracted notes into the requested output language.",
    "Summaries must stay factual and compact. Prefer explicit questions and answers when present.",
  ].join("\n");
}

function buildReduceDeveloperPrompt(language) {
  const lang = language === "ko" ? "Korean" : "English";
  return [
    "You merge chunk-level notes into the final seminar report.",
    "Return only valid JSON matching the schema.",
    `Write the result in ${lang}.`,
    "If source notes mix languages, translate them into the requested output language before writing the final report.",
    "Remove duplicates across chunks and keep the output compact enough for a one-page report.",
  ].join("\n");
}

function chunkForSummary(text, targetChars, overlap) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  if (normalized.length <= targetChars) return [normalized];

  const chunks = [];
  const step = Math.max(800, targetChars - overlap);
  let start = 0;
  const total = normalized.length;
  while (start < total) {
    const end = Math.min(total, start + targetChars);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= total) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function callResponsesWithModelFallback(apiKey, schemaName, schemaConfig, developerPrompt, userPrompt, maxTokens) {
  let lastError = null;
  for (const model of SUMMARY_MODELS) {
    try {
      const result = await callOpenAIResponses(apiKey, model, schemaName, schemaConfig, developerPrompt, userPrompt, maxTokens);
      logJob(appState.activeJobId, "INFO", `summary: completed with ${model}`);
      return result;
    } catch (error) {
      lastError = error;
      logJob(appState.activeJobId, "WARN", `${model} summary 실패: ${String(error.message || error).slice(0, 120)}`);
    }
  }
  throw lastError || new Error("summary failed");
}

async function callOpenAIResponses(apiKey, model, schemaName, schemaConfig, developerPrompt, userPrompt, maxOutputTokens) {
  const payload = {
    model,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: developerPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        schema: schemaConfig,
      },
    },
    max_output_tokens: maxOutputTokens,
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI responses API ${res.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  const outputText = extractOutputText(data);
  const parsed = JSON.parse(outputText);
  return { payload: parsed, responseId: data.id || null, usage: data.usage || {} };
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const lines = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block.text === "string") lines.push(block.text);
      else if (typeof block.output_text === "string") lines.push(block.output_text);
    }
  }
  return lines.join("\n").trim();
}

async function renderReportPdf(job, report, presetId = "classic") {
  setStatus(job.id, "processing", "PDF 렌더링", 80, "페이지/레코드 배치");
  const { jsPDF } = window.jspdf;
  const preset = getOutputPreset(presetId);
  const style = preset.pdf;
  const title = `[Seminar Report] (${job.seminarDate})`;
  const headingPrefix = style.headingPrefix || "1";

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont(style.font, "normal");

  const margin = style.margin;
  const maxWidth = style.maxWidth;
  const pageBottom = 290 - margin;
  let y = 18;

  const ensureSpace = (lines, lineHeight) => {
    const needed = lines * lineHeight;
    if (y + needed > pageBottom) {
      doc.addPage();
      y = 18;
    }
  };

  const line = (txt, size = 10.2, leading = size + 2.3, textStyle = "normal") => {
    doc.setFontSize(size);
    doc.setFont(style.font, textStyle);
    const chunks = doc.splitTextToSize(String(txt), maxWidth);
    const rows = Array.isArray(chunks) ? chunks.length : 1;
    ensureSpace(rows, leading);
    doc.text(chunks, margin, y);
    y += rows * (leading * 0.3528);
  };

  doc.setTextColor(32, 37, 64);
  line(title, style.titleSize, style.titleSize + 4, "bold");
  doc.setTextColor(68, 73, 95);
  line(`${formatDateLabel(job.seminarDate)} ${job.studentName} (${job.studentId})`, style.bodySize + 1.1, 14);
  line(`Template: ${preset.label}`, Math.max(8.6, style.bodySize - 1), 12);
  y += 2;

  doc.setDrawColor(style.dividerColor);
  doc.line(margin, y, margin + maxWidth, y);
  y += 6;

  const sec1 = headingPrefix === "Ⅰ" ? "Ⅰ" : "1.";
  const sec2 = headingPrefix === "Ⅰ" ? "Ⅱ" : "2.";
  const sec3 = headingPrefix === "Ⅰ" ? "Ⅲ" : "3.";
  const sec4 = headingPrefix === "Ⅰ" ? "Ⅳ" : "4.";

  line(`${sec1} Summary`, style.headingSize, style.bodySize + 4, "bold");
  report.summary_sentences.forEach((sentence, index) => line(`${String.fromCharCode(65 + index)}. ${sentence}`, style.bodySize));
  y += 3;

  line(`${sec2} Learnings`, style.headingSize, style.bodySize + 4, "bold");
  line(`A. ${report.learning_sentence}`, style.bodySize);
  y += 3;

  line(`${sec3} QnA`, style.headingSize, style.bodySize + 4, "bold");
  (report.qna || []).slice(0, 3).forEach((pair, index) => {
    line(`${String.fromCharCode(65 + index)}. ${pair.question || ""}`, style.bodySize);
    line(`A. ${pair.answer || ""}`, style.bodySize);
    y += 1;
  });
  if (Array.isArray(report.source_span_notes) && report.source_span_notes.length) {
    line(`${sec4} Source notes`, style.headingSize, style.bodySize + 4, "bold");
    report.source_span_notes.slice(0, 6).forEach((note, index) => line(`${index + 1}. ${note}`, style.bodySize - 0.4));
  }

  const pageCount = doc.getNumberOfPages();
  const blob = new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  logJob(job.id, "INFO", `pdf generated (${pageCount} page)`);
  setStatus(job.id, "processing", "완료", 100, "저장 완료");
  return {
    url,
    mime: "application/pdf",
    createdAt: new Date().toISOString(),
    fileName: `seminar-report-${job.studentId}-${job.seminarDate}-${preset.id}.pdf`,
  };
}

function toMarkdownReport(job, report, presetId = "classic") {
  const preset = getOutputPreset(presetId);
  if (preset.mdTemplate === "academic") {
    return toMarkdownAcademic(job, report, preset);
  }
  if (preset.mdTemplate === "compact") {
    return toMarkdownCompact(job, report, preset);
  }

  return toMarkdownClassic(job, report, preset);
}

function toMarkdownClassic(job, report, preset) {
  const lines = [];
  lines.push(`[Seminar Report] (${job.seminarDate})`);
  lines.push(`Template: ${preset.label}`);
  lines.push(`${formatDateLabel(job.seminarDate)} ${job.studentName} (${job.studentId})`);
  lines.push("");
  lines.push("1. Summary");
  report.summary_sentences.forEach((sentence, index) => lines.push(`${String.fromCharCode(65 + index)}. ${sentence.trim()}`));
  lines.push("");
  lines.push("2. Learnings");
  lines.push(`A. ${report.learning_sentence.trim()}`);
  lines.push("");
  lines.push("3. QnA");
  report.qna.forEach((pair, index) => {
    lines.push(`${String.fromCharCode(65 + index)}. ${pair.question.trim()}`);
    lines.push(`i. ${pair.answer.trim()}`);
  });
  if (Array.isArray(report.source_span_notes) && report.source_span_notes.length > 0) {
    lines.push("");
    lines.push("4. Source notes");
    report.source_span_notes.slice(0, 6).forEach((note, index) => lines.push(`${index + 1}. ${note.trim()}`));
  }
  return lines.join("\n");
}

function toMarkdownCompact(job, report, preset) {
  const lines = [];
  lines.push(`# Seminar Report`);
  lines.push(`**Template:** ${preset.label}`);
  lines.push(`**Date:** ${formatDateLabel(job.seminarDate)}`);
  lines.push(`**Name:** ${job.studentName} (${job.studentId})`);
  lines.push("");
  lines.push("## Summary");
  report.summary_sentences.forEach((sentence, index) => lines.push(`- ${sentence.trim()}`));
  lines.push("");
  lines.push("## Learnings");
  lines.push(`- ${report.learning_sentence.trim()}`);
  lines.push("");
  lines.push("## QnA");
  report.qna.forEach((pair, index) => {
    lines.push(`${index + 1}. ${pair.question.trim()}`);
    lines.push(`   - ${pair.answer.trim()}`);
  });
  if (report.source_span_notes && report.source_span_notes.length) {
    lines.push("");
    lines.push("## Source notes");
    report.source_span_notes.slice(0, 6).forEach((note, index) => lines.push(`- ${note.trim()}`));
  }
  return lines.join("\n");
}

function toMarkdownAcademic(job, report, preset) {
  const lines = [];
  lines.push(`# Seminar Report`);
  lines.push("");
  lines.push(`- **Template:** ${preset.label}`);
  lines.push(`- **Student:** ${job.studentName} (${job.studentId})`);
  lines.push(`- **Date:** ${formatDateLabel(job.seminarDate)}`);
  lines.push("");
  lines.push("## 1. Summary");
  report.summary_sentences.forEach((sentence, index) => lines.push(`${index + 1}. ${sentence.trim()}`));
  lines.push("");
  lines.push("## 2. Learnings");
  lines.push(`- ${report.learning_sentence.trim()}`);
  lines.push("");
  lines.push("## 3. QnA Table");
  lines.push("| No. | Question | Answer |");
  lines.push("| --- | --- | --- |");
  report.qna.forEach((pair, index) => {
    const q = (pair.question || "").replace(/\|/g, "\\|");
    const a = (pair.answer || "").replace(/\|/g, "\\|");
    lines.push(`| ${index + 1} | ${q.trim()} | ${a.trim()} |`);
  });
  if (Array.isArray(report.source_span_notes) && report.source_span_notes.length > 0) {
    lines.push("");
    lines.push("## 4. Source Notes");
    report.source_span_notes.slice(0, 6).forEach((note) => {
      lines.push(`- ${note.trim()}`);
    });
  }
  return lines.join("\n");
}

function formatDateLabel(dateString) {
  const d = new Date(`${dateString}T00:00:00`);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월 ${String(d.getDate()).padStart(2, "0")}일`;
}

function startLiveTicker() {
  appState.progressTimer = setInterval(() => {
    if (!appState.activeJobId) return;
    const job = appState.jobs.find((j) => j.id === appState.activeJobId);
    if (!job) return;

    if (job.status === "processing") {
      const target = Number.isFinite(job.progressTarget) ? Number(job.progressTarget) : Number(job.progress || 0);
      const gap = target - job.progress;
      const step = Math.min(3, 0.2 + Math.abs(gap) * 0.18);

      if (Math.abs(gap) > 0.06) {
        job.progress += Math.sign(gap) * Math.min(Math.abs(gap), step);
      } else if (job.progress < Math.min(target, 96)) {
        job.progress = Math.min(96, job.progress + 0.05);
      }
      job.progress = Number(job.progress.toFixed(1));
    }

    liveTitle.textContent = `실행 중: ${job.studentName} (${job.fileName})`;
    liveProgress.style.width = `${job.progress}%`;
    const queuePos = queuePosition(job.id);
    const qtxt = queuePos ? `현재 대기순위: ${queuePos}` : "실시간 처리 중";
    const idleSec = job.lastLogAt ? Math.floor((Date.now() - job.lastLogAt) / 1000) : 0;
    const activityText = idleSec >= 20 ? ` · 마지막 로그 ${idleSec}초 전` : "";
    if (idleSec >= 45 && !job.stallNoticeAt) {
      job.stallNoticeAt = Date.now();
      logJob(job.id, "WARN", "작업 응답이 지연되고 있습니다. 네트워크/요청 응답 대기 중일 수 있습니다.");
    }
    const hasInlineDetail = typeof job.stage === "string" && job.stage.includes("(") && job.stage.includes(")");
    const liveDetail = !hasInlineDetail && job.progressDetail ? ` (${job.progressDetail})` : "";
    liveMeta.textContent = `상태: ${job.stage}${liveDetail} · 진행률: ${job.progress.toFixed(1)}% · ${qtxt} · ${formatBytes(job.file.size)} · ${job.createdAt}${activityText}`;
    renderLiveConsole();
  }, POLL_MS);
}

function renderLiveConsole() {
  if (!appState.activeJobId) {
    liveConsole.innerHTML = "";
    renderLogTimeline(liveConsole, [], "console-empty");
    liveConsole.textContent = "처리 중인 작업 없음";
    liveConsole.classList.remove("console-empty");
    liveConsole.classList.add("console-empty");
    return;
  }
  const job = appState.jobs.find((j) => j.id === appState.activeJobId);
  if (!job) {
    liveConsole.innerHTML = "";
    renderLogTimeline(liveConsole, [], "console-empty");
    liveConsole.textContent = "작업을 찾을 수 없습니다.";
    return;
  }
  renderLogTimeline(liveConsole, job.logs.slice(-220), "console-empty");
  liveConsole.scrollTop = liveConsole.scrollHeight;
}

function renderJobs() {
  if (!jobsList) return;
  jobsList.innerHTML = appState.jobs.length === 0 ? `<div class="muted">아직 제출된 작업이 없습니다.</div>` : "";

  const sorted = [...appState.jobs].sort((a, b) => {
    const rank = (s) => (s.status === "processing" ? 0 : s.status === "queued" ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const job of sorted) {
    const pos = queuePosition(job.id);
    const rankText = pos ? `· 대기순위 ${pos}` : "";
    const statusClass = `job-${job.status}`;
    const card = document.createElement("div");
    card.className = "job";

    const header = document.createElement("div");
    header.className = "row";
    header.innerHTML = `<strong>${escapeHtml(job.studentName)}</strong> <span class="badge ${statusClass}">${escapeHtml(job.status)} ${rankText}</span>`;
    card.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "muted";
    const preset = getOutputPreset(job.outputPresetId);
    const stageHasInlineDetail = typeof job.stage === "string" && job.stage.includes("(") && job.stage.includes(")");
    const stageText = job.progressDetail && !stageHasInlineDetail ? `${job.stage} (${job.progressDetail})` : job.stage;
    meta.textContent = `${job.studentId} · ${job.fileName} · ${formatBytes(job.file.size)} · 출력: ${preset.label} · ${stageText}`;
    card.appendChild(meta);

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${Math.min(100, Math.max(0, job.progress))}%`;
    track.appendChild(fill);
    card.appendChild(track);

    const etaText = document.createElement("div");
    etaText.className = "muted";
    etaText.textContent = job.status === "done"
      ? "완료"
      : job.status === "error"
      ? `오류: ${job.error || "알 수 없음"}`
      : job.status === "processing"
      ? `진행률 ${Math.min(100, Math.max(0, job.progress)).toFixed(1)}%`
      : pos
      ? `현재 대기열: ${appState.jobs.filter((j) => j.status === "queued").length}개`
      : "-";
    card.appendChild(etaText);

    const actions = document.createElement("div");
    actions.className = "actions";

    if (job.status === "done" && job.output?.pdf?.url) {
      const a1 = document.createElement("a");
      a1.href = job.output.pdf.url;
      a1.download = job.output.pdf.fileName;
      a1.className = "footer-link";
      a1.textContent = "PDF 다운로드";

      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([job.output.md || ""], { type: "text/markdown;charset=utf-8" }));
      a2.download = `seminar-report-${job.studentId}-${job.seminarDate}-${getOutputPreset(job.outputPresetId).id}.md`;
      a2.className = "footer-link";
      a2.style.marginLeft = "8px";
      a2.textContent = "Markdown 다운로드";

      actions.appendChild(a1);
      actions.appendChild(a2);
    }

    card.appendChild(actions);

    const log = document.createElement("div");
    renderJobLogSummary(log, job.logs, 3);
    card.appendChild(log);

    jobsList.appendChild(card);
  }

  if (appState.activeJobId) {
    renderLiveConsole();
    const active = appState.jobs.find((j) => j.id === appState.activeJobId);
    if (active) {
      liveProgress.style.width = `${Math.min(100, Math.max(0, active.progress))}%`;
      liveTitle.textContent = `실행 중: ${active.studentName} (${active.fileName})`;
    }
  } else {
    liveTitle.textContent = "실행 중인 job이 없습니다.";
    liveProgress.style.width = "0%";
    liveMeta.textContent = "";
    if (!liveConsole.textContent.includes("없음")) renderLiveConsole();
  }
}

function render() {
  renderJobs();
  renderLiveConsole();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}
