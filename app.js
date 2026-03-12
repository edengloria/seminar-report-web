const STT_MODEL_OPTIONS = ["gpt-4o-transcribe", "whisper-1"];
const STT_MODEL_DEFAULT = STT_MODEL_OPTIONS[0];
const SUMMARY_MODEL_OPTIONS = [
  { value: "gpt-5.2", label: "gpt-5.2 (최신 고정밀/권장)" },
  { value: "gpt-5.2-codex", label: "gpt-5.2-codex (코드 특화)" },
  { value: "gpt-5.1", label: "gpt-5.1 (고정밀)" },
  { value: "gpt-5-mini", label: "gpt-5-mini (빠른 요약)" },
  { value: "gpt-5-nano", label: "gpt-5-nano (저비용)" },
  { value: "gpt-4.1", label: "gpt-4.1 (균형)" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini (저지연)" },
  { value: "gpt-4.1-nano", label: "gpt-4.1-nano (초저비용)" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini (범용 저비용)" },
  { value: "o4-mini", label: "o4-mini (추론 효율형)" },
];
const SUMMARY_MODELS = SUMMARY_MODEL_OPTIONS.map((item) => item.value);
const SUMMARY_MODELS_DEFAULT = SUMMARY_MODELS[0];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const STT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const STT_SEGMENT_BYTES = 18 * 1024 * 1024;
const STT_MIN_SEGMENT_BYTES = 4 * 1024 * 1024;
const STT_CHUNK_SECONDS = 180;
const STT_CHUNK_OVERLAP_SECONDS = 12;
const POLL_MS = 1000;
const TRANSCRIBE_REQUEST_TIMEOUT_MS = 7 * 60 * 1000;
const TRANSCRIBE_RETRY_LIMIT = 3;
const STT_RETRY_INTERVAL_MS = 1200;
const ALLOWED_EXTENSIONS = ["m4a", "mp3", "wav", "ogg", "flac", "aac", "opus", "webm", "mp4", "mov", "m4v", "avi", "mkv", "3gp", "oga", "ogv", "wma", "mp4a"];
const REPORT_MIN_SUMMARY_TOTAL_CHARS = 1150;
const REPORT_MIN_LEARNING_CHARS = 150;
const REPORT_MIN_QA_QUESTION_CHARS = 90;
const REPORT_MIN_QA_ANSWER_CHARS = 160;
const REPORT_MAX_SUMMARY_SENTENCE_CHARS = 760;
const REPORT_MAX_LEARNING_CHARS = 320;
const REPORT_MAX_QA_QUESTION_CHARS = 280;
const REPORT_MAX_QA_ANSWER_CHARS = 620;
const PDF_PDF_ATTEMPT_STAGES = 5;
const PDF_PREFERRED_FONT_SIZES = [11.0, 10.5, 9.5];
const PDF_SUMMARY_TRUNCATION_LIMITS = [260, 220, 180, 150, 125];
const PDF_LEARNING_TRUNCATION_LIMITS = [180, 150, 120, 100, 90];
const PDF_QA_QUESTION_TRUNCATION_LIMITS = [220, 190, 160, 130, 110];
const PDF_QA_ANSWER_TRUNCATION_LIMITS = [220, 180, 150, 110, 90];
const REPORT_DENSITY_MAX_TRANSCRIPT_CHARS = 14000;
const REPORT_DENSITY_REFINE_ROUNDS = 2;
const RAW_TRANSCRIPT_PREVIEW_CHARS = 12000;
const ASCII_ONLY_ERROR_MSG = "이름과 학번은 PDF 생성 안정성을 위해 영문/숫자/띄어쓰기/기호(_ . -)만 허용됩니다.";

const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title_topic", "summary_sentences", "learning_sentence", "qna"],
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

function resolveSummaryModel(value) {
  const trimmed = String(value || "").trim();
  return SUMMARY_MODELS.includes(trimmed) ? trimmed : SUMMARY_MODELS_DEFAULT;
}

function resolveSttModel(value) {
  const trimmed = String(value || "").trim();
  return STT_MODEL_OPTIONS.includes(trimmed) ? trimmed : STT_MODEL_DEFAULT;
}

function buildSttModelCandidates(preferredModel) {
  const primary = resolveSttModel(preferredModel);
  const candidates = [primary];
  for (const model of STT_MODEL_OPTIONS) {
    if (!candidates.includes(model)) {
      candidates.push(model);
    }
  }
  return candidates;
}

function resolveSttResponseFormats(model) {
  const modelKey = String(model || "").toLowerCase();
  if (modelKey.includes("gpt-4o") && modelKey.includes("transcribe")) {
    return ["json", "text"];
  }
  return ["verbose_json", "json", "text"];
}

function isAsciiOnly(value) {
  return /^[A-Za-z0-9\s._-]+$/.test(String(value || ""));
}

function sanitizeForPdf(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateForDisplay(value, maxChars) {
  const text = String(value || "").trim();
  const limit = Math.max(1, Number(maxChars) || 0);
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function makeRawTranscriptDisplayText(value, maxChars = RAW_TRANSCRIPT_PREVIEW_CHARS) {
  return truncateForDisplay(
    String(value || "")
      .replace(/\r\n/g, "\n")
      .trim(),
    maxChars
  );
}

function isReportDenseEnough(report) {
  if (!report || typeof report !== "object") return false;
  const summary = Array.isArray(report.summary_sentences) ? report.summary_sentences : [];
  const qna = Array.isArray(report.qna) ? report.qna : [];
  const learning = String(report.learning_sentence || "").trim();
  const summaryLen = summary.join(" ").trim().length;
  const learningLen = learning.length;
  if (summary.length !== 3) return false;
  if (learningLen < REPORT_MIN_LEARNING_CHARS) return false;
  if (summaryLen < REPORT_MIN_SUMMARY_TOTAL_CHARS) return false;
  if (qna.length !== 3) return false;

  for (const pair of qna) {
    const question = String(pair?.question || "").trim();
    const answer = String(pair?.answer || "").trim();
    if (question.length < REPORT_MIN_QA_QUESTION_CHARS || answer.length < REPORT_MIN_QA_ANSWER_CHARS) {
      return false;
    }
  }

  return true;
}

function buildDensityTargets() {
  return {
    minSummaryChars: REPORT_MIN_SUMMARY_TOTAL_CHARS,
    minLearningChars: REPORT_MIN_LEARNING_CHARS,
    minQuestionChars: REPORT_MIN_QA_QUESTION_CHARS,
    minAnswerChars: REPORT_MIN_QA_ANSWER_CHARS,
  };
}

function getSummaryModelSummary(job) {
  const requested = job?.requestedSummaryModel || SUMMARY_MODELS_DEFAULT;
  const used = Array.isArray(job?.usedSummaryModels) && job.usedSummaryModels.length > 0
    ? job.usedSummaryModels
    : [];
  const timeline = [];
  if (requested) timeline.push(requested);
  for (const item of used) {
    if (!timeline.includes(item)) timeline.push(item);
  }
  return timeline.join(" → ");
}

function getSttModelSummary(job) {
  const requested = job?.requestedSttModel || STT_MODEL_DEFAULT;
  const used = Array.isArray(job?.usedSttModels) && job.usedSttModels.length > 0
    ? job.usedSttModels
    : [];
  const timeline = [];
  if (requested) timeline.push(requested);
  for (const item of used) {
    if (!timeline.includes(item)) timeline.push(item);
  }
  return timeline.join(" → ");
}

const mapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary_points", "learning_candidates", "qna_candidates"],
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
  },
};

const appState = {
  jobs: [],
  activeJobId: null,
  startedAt: new Map(),
  progressTimer: null,
  lastJobsRenderAt: 0,
};
const PDF_FONT = {
  name: "NotoSansKR",
  file: "NotoSansKR[wght].ttf",
  url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
  loaded: false,
  loading: null,
  failed: false,
};
const uiRenderQueue = {
  queued: false,
  jobs: false,
  live: false,
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
  const requestedSummaryModel = resolveSummaryModel(document.getElementById("summary-model")?.value);
  const fileInput = document.getElementById("audio-file");
  const file = fileInput.files[0];

  if (!name || !studentId || !date || !apiKey || !file) {
    formError.textContent = "모든 항목을 입력해 주세요.";
    return;
  }
  if (!isAsciiOnly(name) || !isAsciiOnly(studentId)) {
    formError.textContent = ASCII_ONLY_ERROR_MSG;
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
  if (file.size > STT_MAX_FILE_SIZE) {
    const decodable = await canDecodeInBrowser(file);
    if (!decodable) {
      formError.textContent =
        "브라우저에서 이 파일 코덱을 디코딩하지 못합니다. 25MB 이하 파일이거나 WAV/MP3로 변환한 파일을 업로드해 주세요.";
      return;
    }
  }

  const job = {
    id: `job_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    studentName: name,
    studentId,
    seminarDate: date,
    outputPresetId: getOutputPreset(outputPresetId).id,
    requestedSummaryModel,
    requestedSttModel: STT_MODEL_DEFAULT,
    usedSummaryModels: [],
    usedSttModels: [],
    fileName: file.name,
    file,
    apiKey,
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
  scheduleRender({ jobs: true, live: true });
  logJob(job.id, "INFO", "submit: queued");
  if (!appState.activeJobId) {
    void processQueue();
  }
}

async function canDecodeInBrowser(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !file) return false;
  const audioCtx = new AudioCtx();
  try {
    const raw = await file.arrayBuffer();
    await audioCtx.decodeAudioData(raw.slice(0));
    return true;
  } catch (_) {
    return false;
  } finally {
    await audioCtx.close().catch(() => {});
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

function scheduleRender(options = { jobs: true, live: true }) {
  uiRenderQueue.jobs = uiRenderQueue.jobs || Boolean(options.jobs);
  uiRenderQueue.live = uiRenderQueue.live || Boolean(options.live);
  if (uiRenderQueue.queued) return;
  uiRenderQueue.queued = true;

  requestAnimationFrame(() => {
    const shouldRenderJobs = uiRenderQueue.jobs;
    const shouldRenderLive = uiRenderQueue.live;
    uiRenderQueue.queued = false;
    uiRenderQueue.jobs = false;
    uiRenderQueue.live = false;

    if (shouldRenderJobs) renderJobs();
    if (shouldRenderLive) renderLiveConsole();
  });
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
  const isStallWarning =
    String(level || "").toUpperCase() === "WARN" &&
    String(message || "").includes("작업 응답이 지연되고 있습니다.");
  if (!isStallWarning) {
    job.stallNoticeAt = null;
  } else if (!job.stallNoticeAt) {
    job.stallNoticeAt = Date.now();
  }
  scheduleRender({ jobs: true, live: appState.activeJobId === jobId });
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
  scheduleRender({ jobs: true, live: true });
}

function recordSummaryModelUsage(job, model) {
  if (!job || !model) return;
  if (!Array.isArray(job.usedSummaryModels)) {
    job.usedSummaryModels = [];
  }
  if (!job.usedSummaryModels.includes(model)) {
    job.usedSummaryModels.push(model);
  }
}

function recordSttModelUsage(job, model) {
  if (!job || !model) return;
  if (!Array.isArray(job.usedSttModels)) {
    job.usedSttModels = [];
  }
  if (!job.usedSttModels.includes(model)) {
    job.usedSttModels.push(model);
  }
}

async function processQueue() {
  if (appState.activeJobId) return;
  const next = appState.jobs.find((j) => j.status === "queued");
  if (!next) {
    appState.activeJobId = null;
    scheduleRender({ jobs: true, live: true });
    return;
  }

  appState.activeJobId = next.id;
  setStatus(next.id, "processing", "전처리/인덱싱", 2, "큐에서 실행 대기 진입");
  logJob(next.id, "INFO", "processing started");

  try {
    const transcript = await transcribeAudio(next);
    next.output.transcript = transcript;
    setStatus(next.id, "processing", "요약 생성", 45, "요약 텍스트 정합성 검사");

    const summary = await summarizeTranscript(next, transcript);
    const report = summary.report;
    const modelSummary = (summary.usedModels || []).join(" / ") || next.requestedSummaryModel;
    logJob(next.id, "INFO", `요약 완료: 사용 모델 ${modelSummary}`);
    next.output.report = normalizeReportOutput(report);
    setStatus(next.id, "processing", "PDF 렌더링", 78, "PDF 레이아웃 구성");

    const pdf = await renderReportPdf(next, report, next.outputPresetId);
    const pdfFitMode = pdf?.fitMode || "unknown";
    logJob(next.id, "INFO", `PDF 렌더링 완료 (fitMode: ${pdfFitMode})`);
    next.output.pdfFitMode = pdfFitMode;
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
    scheduleRender({ jobs: true, live: true });
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
  const apiKey = String(job.apiKey || "").trim();
  if (!apiKey) throw new Error("API key missing");

  if (job.file.size <= STT_MAX_FILE_SIZE) {
    logJob(job.id, "INFO", `single pass 전사 시작: ${formatBytes(job.file.size)} (임계값 ${formatBytes(STT_MAX_FILE_SIZE)})`);
    const single = await transcribeChunkWithAutoRetry(
      apiKey,
      job.id,
      job.file,
      0,
      STT_SEGMENT_BYTES,
      job.requestedSttModel
    );
    const singleText = String(single?.text || "").trim();
    const singleSegments = Array.isArray(single?.segments) ? single.segments : [];
    const restoredSingleText = singleText || singleSegments.map((s) => String(s?.text || "").trim()).filter(Boolean).join(" ").trim();
    if (!restoredSingleText) {
      throw new Error(`transcription failed: empty single-pass transcript (segments=${singleSegments.length})`);
    }
    if (!singleText && restoredSingleText) {
      logJob(job.id, "WARN", `single pass text가 비어 segments 기반으로 복구했습니다. (segments=${singleSegments.length})`);
    }
    job.output.transcriptAligned = singleSegments;
    job.output.rawTranscript = restoredSingleText;
    job.output.rawTranscriptPreDedupe = restoredSingleText;
    job.output.rawTranscriptPreDedupeLength = restoredSingleText.length;
    job.output.rawTranscriptLength = restoredSingleText.length;
    job.output.rawTranscriptSegments = Array.isArray(singleSegments) ? singleSegments.length : 0;
    logJob(job.id, "INFO", "transcription completed without split");
    setStatus(job.id, "processing", "요약으로 텍스트 정리", 35, "단일 청크 완결");
    return restoredSingleText;
  }

  logJob(
    job.id,
    "INFO",
    `파일 크기 ${Math.round(job.file.size / (1024 * 1024))}MB: STT 분할 모드로 처리합니다. (기준 ${Math.round(STT_MAX_FILE_SIZE / (1024 * 1024))}MB)`
  );
  let segments = [];
  try {
    segments = await splitAudioForStt(job.file, STT_SEGMENT_BYTES, STT_CHUNK_SECONDS, STT_CHUNK_OVERLAP_SECONDS);
  } catch (error) {
    const message = String(error?.message || error);
    if (/오디오 디코딩 실패|decode audio/i.test(message)) {
      throw new Error(
        "브라우저에서 이 오디오 코덱을 디코딩하지 못해 분할 전사를 진행할 수 없습니다. WAV/MP3로 변환 후 재시도하거나 25MB 이하 파일로 업로드해 주세요."
      );
    }
    throw error;
  }
  if (!segments.length) {
    throw new Error("Failed to split audio into valid chunks");
  }
  logJob(
    job.id,
    "INFO",
    `초기 오디오 분할 완료: ${segments.length}개 조각 (타임윈도우 ${STT_CHUNK_SECONDS}초, 오버랩 ${STT_CHUNK_OVERLAP_SECONDS}초)`
  );

  const combinedTextParts = [];
  const combinedSegments = [];
  let emptyTextChunks = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const progress = 5 + Math.round((30 * (i + 1)) / segments.length);
    setStatus(job.id, "processing", "Whisper 전사 중", progress, `분할 ${i + 1}/${segments.length}`);
    const result = await transcribeChunkWithAutoRetry(
      apiKey,
      job.id,
      segment.blob,
      segment.startTimeSec,
      STT_SEGMENT_BYTES,
      job.requestedSttModel
    );
    const chunkText = String(result.text || "").trim();
    if (chunkText) {
      combinedTextParts.push(chunkText);
    } else {
      emptyTextChunks += 1;
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

  let mergedText = combinedTextParts.join("\n").trim();
  if (!mergedText && combinedSegments.length > 0) {
    mergedText = combinedSegments
      .map((segment) => String(segment?.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (mergedText) {
      logJob(job.id, "WARN", `전사 본문 텍스트가 비어 segments 기반으로 병합 복구했습니다. (empty chunks ${emptyTextChunks}/${segments.length})`);
    }
  }
  if (!mergedText) {
    throw new Error(`transcription failed: empty transcript (chunks=${segments.length}, emptyTextChunks=${emptyTextChunks}, aligned=${combinedSegments.length})`);
  }

  const dedupText = dedupeTranscriptText(mergedText) || mergedText;
  const dedupSegments = dedupeAlignedSegments(combinedSegments);
  const finalSegments = dedupSegments.length > 0 ? dedupSegments : combinedSegments;
  job.output.rawTranscriptPreDedupe = mergedText;
  job.output.rawTranscript = dedupText;
  job.output.rawTranscriptLength = dedupText.length;
  job.output.rawTranscriptPreDedupeLength = mergedText.length;
  job.output.rawTranscriptSegments = finalSegments.length;
  logJob(
    job.id,
    "INFO",
    `transcription completed with ${segments.length} chunks · empty text chunks ${emptyTextChunks}/${segments.length} · segments in: ${combinedSegments.length} → ${finalSegments.length}`
  );
  setStatus(job.id, "processing", "요약으로 텍스트 정리", 35, "분할 전사 병합");
  job.output.transcriptAligned = finalSegments;
  return dedupText;
}

async function transcribeSingleFile(file, apiKey, timeOffsetSec = 0, preferredModel = STT_MODEL_DEFAULT) {
  let lastError = null;
  const job = appState.jobs.find((j) => j.id === appState.activeJobId);
  const models = buildSttModelCandidates(preferredModel);
  for (const model of models) {
    const responseFormats = resolveSttResponseFormats(model);
    for (const responseFormat of responseFormats) {
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
          if (responseFormat !== "text" && (body.includes("unsupported") || body.includes("unsupported_value"))) {
            logJob(job?.id || appState.activeJobId, "WARN", `${model} / ${responseFormat} 포맷 미지원 -> 재시도`);
            continue;
          }
          throw err;
        }

        if (responseFormat === "text") {
          const text = (await res.text()).trim();
          if (!text) {
            throw new Error(`${model} text 응답이 비어 있습니다.`);
          }
          recordSttModelUsage(job, model);
          return { text, segments: [{ start: timeOffsetSec, end: timeOffsetSec, text }] };
        }

        const payload = await res.json();
        const parsed = extractTranscriptFromPayload(payload, timeOffsetSec);
        const hasText = Boolean(parsed?.text);
        const hasSegments = Array.isArray(parsed?.segments) && parsed.segments.length > 0;
        if (!hasText && !hasSegments) {
          throw new Error(`${model} 응답 파싱 결과가 비어 있습니다.`);
        }
        recordSttModelUsage(job, model);
        return parsed;
      } catch (error) {
        lastError = error;
        if (responseFormat !== "text") {
          logJob(job?.id || appState.activeJobId, "WARN", `${model}/${responseFormat} 실패 -> 재시도`);
          continue;
        }
        logJob(job?.id || appState.activeJobId, "WARN", `${model}/${responseFormat} 실패 -> 다른 모델/형식 재시도`);
      }
    }
  }
  throw lastError || new Error("transcription failed");
}

async function transcribeChunkWithAutoRetry(apiKey, jobId, file, timeOffsetSec = 0, targetBytes = STT_SEGMENT_BYTES, preferredSttModel = STT_MODEL_DEFAULT) {
  if (!file || !file.size) {
    throw new Error("audio chunk is empty");
  }
  const job = appState.jobs.find((j) => j.id === jobId);
  const jobLabel = file.size ? `(${Math.round(file.size / (1024 * 1024))}MB)` : "";
  const chunkStart = Date.now();
  try {
    const presetLabel = job ? ` [${job.outputPresetId || "N/A"}]` : "";
    logJob(jobId, "INFO", `transcribe attempt${presetLabel} ${jobLabel}`);
    return await transcribeSingleFile(file, apiKey, timeOffsetSec, preferredSttModel);
  } catch (error) {
    const message = String(error?.message || error);
    const detailSec = ((Date.now() - chunkStart) / 1000).toFixed(1);
    if (message.includes("timed out")) {
      if (job && !job.stallNoticeAt) {
        job.stallNoticeAt = Date.now();
        setStatus(jobId, "processing", "Whisper 전사 중", job.progressTarget || 35, "타임아웃 재시도");
        logJob(jobId, "WARN", `transcribe timeout (${detailSec}s): ${message}`);
      }
      return withBackoffRetry(() => transcribeSingleFile(file, apiKey, timeOffsetSec, preferredSttModel), jobId, 1);
    }
    if (isTransientTranscribeError(message)) {
      if (job) {
        setStatus(jobId, "processing", "Whisper 전사 중", job.progressTarget || 35, `일시적 오류 재시도 (소요 ${detailSec}s)`);
        logJob(jobId, "WARN", `transcribe temporary failure (${detailSec}s), retrying: ${message}`);
      }
      return withBackoffRetry(() => transcribeSingleFile(file, apiKey, timeOffsetSec, preferredSttModel), jobId, 1);
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
        nextTarget,
        job.requestedSttModel
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
  if (text) {
    return { text, segments: [{ start: startOffset, end: startOffset, text }] };
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

function normalizeTranscriptText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ\s]/g, "").trim();
}

function tokenSetFromNormalized(normalized) {
  const tokens = String(normalized || "")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function splitToSentences(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function dedupeTranscriptText(text) {
  const sentences = splitToSentences(text);
  const kept = [];
  const output = [];

  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index];
    const normalized = normalizeTranscriptText(sentence);
    if (!normalized) continue;

    const tokenSet = tokenSetFromNormalized(normalized);
    const normalizedTokens = normalized.split(/\s+/).filter(Boolean);
    let isDuplicate = false;
    for (let i = kept.length - 1; i >= 0; i--) {
      const prev = kept[i];
      if (index - prev.index > 6) break;
      if (normalized === prev.normalized) {
        isDuplicate = true;
        break;
      }
      if (jaccardSimilarity(tokenSet, prev.tokenSet) >= 0.9) {
        isDuplicate = true;
        break;
      }
      if (normalized.includes(prev.normalized) || prev.normalized.includes(normalized)) {
        isDuplicate = true;
        break;
      }
      const overlap = overlapRatio(prev.normalized, normalizedTokens.join(" "));
      if (overlap >= 0.9) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    kept.push({ index, normalized, tokenSet });
    output.push(sentence);
  }

  return output.join(" ").trim();
}

function dedupeAlignedSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const sorted = [...segments].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  const deduped = [];
  const recent = [];
  const overlapWindowSec = Math.max(STT_CHUNK_OVERLAP_SECONDS * 4, 48);

  for (const segment of sorted) {
    const text = String(segment?.text || "").trim();
    if (!text) continue;
    const cleaned = postprocessSegmentText(text);
    if (!cleaned) continue;
    const normalized = normalizeTranscriptText(cleaned);
    if (!normalized) continue;
    const tokenSet = tokenSetFromNormalized(normalized);
    const startSec = Number(segment.start || 0);

    const isDuplicate = recent.some((entry) => {
      const nearInTime = Math.abs(startSec - entry.startSec) <= overlapWindowSec;
      if (!nearInTime) return false;
      if (normalized === entry.normalized) return true;
      if (jaccardSimilarity(tokenSet, entry.tokenSet) >= 0.9) return true;
      if (normalized.includes(entry.normalized) || entry.normalized.includes(normalized)) return true;
      return overlapRatio(entry.normalized, normalized) >= 0.88;
    });
    if (isDuplicate) continue;

    recent.push({
      text: cleaned,
      normalized,
      tokenSet,
      startSec,
    });
    if (recent.length > 14) recent.shift();

    deduped.push({
      start: startSec,
      end: Number(segment.end || segment.start || 0),
      text: cleaned,
    });
  }

  return mergeOverlappingSegments(deduped);
}

function overlapRatio(left, right) {
  const leftTokens = String(left || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const rightTokens = String(right || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = Array.from(leftSet).reduce(
    (count, token) => (rightSet.has(token) ? count + 1 : count),
    0
  );
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function postprocessSegmentText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const tokens = text.split(" ");
  const deduped = [];
  let prev = "";
  for (const token of tokens) {
    const item = String(token || "").trim();
    if (!item) continue;
    const normalized = normalizeTranscriptText(item);
    if (!normalized) continue;
    if (normalized === prev) continue;
    deduped.push(item);
    prev = normalized;
  }
  return deduped.join(" ").trim();
}

function mergeOverlappingSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  const merged = [];

  for (const segment of sorted) {
    if (!segment?.text) continue;
    const text = postprocessSegmentText(segment.text);
    if (!text) continue;

    if (!merged.length) {
      merged.push({
        start: Number(segment.start || 0),
        end: Number(segment.end || segment.start || 0),
        text,
      });
      continue;
    }

    const current = {
      start: Number(segment.start || 0),
      end: Number(segment.end || segment.start || 0),
      text,
    };
    const prev = merged[merged.length - 1];
    const currentNorm = normalizeTranscriptText(current.text);
    const prevNorm = normalizeTranscriptText(prev.text);
    const nearTime = current.start <= prev.end + (STT_CHUNK_OVERLAP_SECONDS * 4);

    if (nearTime && (overlapRatio(prevNorm, currentNorm) >= 0.9 || prevNorm.includes(currentNorm) || currentNorm.includes(prevNorm))) {
      if (current.text.length > prev.text.length) {
        merged[merged.length - 1] = current;
      }
      continue;
    }

    if (nearTime && current.start <= prev.end + 0.2 && current.text.length > 20) {
      const mergedText = postprocessSegmentText(`${prev.text} ${current.text}`);
      if (mergedText.length >= prev.text.length) {
        merged[merged.length - 1] = {
          start: prev.start,
          end: current.end,
          text: mergedText,
        };
        continue;
      }
    }

    merged.push(current);
  }

  return merged.map((segment, index) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
    id: `s${String(index).padStart(5, "0")}`,
  }));
}

async function splitAudioForStt(file, targetBytes, targetSeconds = STT_CHUNK_SECONDS, overlapSeconds = STT_CHUNK_OVERLAP_SECONDS) {
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
    const maxSamplesBySize = Math.max(
      1,
      Math.floor((sampleRate * Math.max(targetBytes - 44, 0)) / Math.max(channels * 2, 1))
    );
    const maxSamplesByTime = Math.max(1, Math.floor(sampleRate * Math.max(1, targetSeconds)));
    const isSizeConstrained = maxSamplesBySize < maxSamplesByTime;
    const maxSamplesPerChunk = isSizeConstrained ? maxSamplesBySize : maxSamplesByTime;
    const chunkWindowSec = Math.max(1, Math.round(maxSamplesPerChunk / sampleRate));
    const overlapSamples = Math.max(
      0,
      Math.min(Math.floor(sampleRate * Math.max(0, overlapSeconds)), Math.max(0, maxSamplesPerChunk - 1))
    );
    const stepSamples = Math.max(1, maxSamplesPerChunk - overlapSamples);
    const chunks = [];
    const projectedChunkCount = Math.max(1, Math.ceil(totalSamples / stepSamples));
    const chunkLabel = `${(file.size / (1024 * 1024)).toFixed(1)}MB`;
    logJob(
      appState.activeJobId,
      "INFO",
      `오디오 분할: ${chunkLabel} / ${chunkWindowSec}초 타임윈도우 + 오버랩 ${Math.round(overlapSamples / sampleRate)}초, ${
        isSizeConstrained ? "API 용량 상한 적용" : "타임 기준 우선"
      }, 예상 ${projectedChunkCount}개 (타임라인=${STT_CHUNK_SECONDS}초)`
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
      cursor = Math.min(totalSamples, cursor + stepSamples);
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
  const apiKey = String(job.apiKey || "").trim();
  const preferredModel = resolveSummaryModel(job?.requestedSummaryModel);
  let effectiveTranscript = String(transcriptText || "").trim();
  if (!effectiveTranscript) {
    const aligned = Array.isArray(job?.output?.transcriptAligned) ? job.output.transcriptAligned : [];
    if (aligned.length > 0) {
      effectiveTranscript = aligned
        .map((segment) => String(segment?.text || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (effectiveTranscript) {
        logJob(job.id, "WARN", `요약 진입 시 transcript 비어 aligned segments 기반으로 복구했습니다. (segments=${aligned.length})`);
      }
    }
  }
  if (!effectiveTranscript || !apiKey) throw new Error("No transcript text");

  const language = "en";
  const safeLang = language === "ko" ? "Korean" : "English";
  const tokenEstimate = Math.max(1, Math.round(effectiveTranscript.length / 3));
  const usedModels = new Set();

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
      buildSinglePassPrompt(effectiveTranscript, job, language),
      2500,
      preferredModel
    );
    usedModels.add(result.model);
    recordSummaryModelUsage(job, result.model);
    const base = normalizeReportOutput(result.payload);
    const dense = await ensureReportDensity(job, apiKey, base, effectiveTranscript, preferredModel, usedModels);
    return { report: dense, usedModels: Array.from(usedModels) };
  }

  const chunks = chunkForSummary(effectiveTranscript, 28000, 7000);
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
      1800,
      preferredModel
    );
    usedModels.add(result.model);
    recordSummaryModelUsage(job, result.model);
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
    2200,
    preferredModel
  );
  usedModels.add(finalResult.model);
  recordSummaryModelUsage(job, finalResult.model);
  const base = normalizeReportOutput(finalResult.payload);
  const dense = await ensureReportDensity(job, apiKey, base, effectiveTranscript, preferredModel, usedModels);
  return { report: dense, usedModels: Array.from(usedModels) };
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
    "- Write a full one-page level report: no extremely short bullet lines; prefer complete explanatory writing.",
    "- Keep enough detail to be useful, but do not exceed a one-page output size.",
    "- Each section should be concrete and include method, constraint, and outcome details where available.",
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
    "Remove duplicates across chunks and keep the output compact enough for a one-page report.",
  ].join("\n");
}

function buildDensityDeveloperPrompt(language) {
  const lang = language === "ko" ? "Korean" : "English";
  const target = buildDensityTargets();
  return [
    "You refine the draft seminar report to better fill one A4 page without exceeding it.",
    "Return only valid JSON matching the schema.",
    `Write the result in ${lang}.`,
    "Do not change meaning; use the same transcript facts only.",
    "Keep exact output structure: 3 summary sentences, 1 learning sentence, 3 QnA pairs.",
    "Avoid short, thin wording. Expand each section with concrete details from the source, but keep the output one-page length.",
    "If a section can be improved by adding context, examples, constraints, assumptions, or methods, add them in clear concise sentences.",
    `Ensure final text is substantial: summary total >= ${target.minSummaryChars} chars, learning >= ${target.minLearningChars} chars, QnA questions >= ${target.minQuestionChars} chars and answers >= ${target.minAnswerChars} chars.`,
    "If source details are insufficient, keep factual and concise, but still maximize completeness.",
  ].join("\n");
}

function buildDensityPrompt(currentReport, transcriptText) {
  const current = currentReport && typeof currentReport === "object" ? currentReport : {};
  return [
    "[Current report draft]",
    JSON.stringify(
      {
        title_topic: current.title_topic || "",
        summary_sentences: Array.isArray(current.summary_sentences) ? current.summary_sentences : [],
        learning_sentence: String(current.learning_sentence || ""),
        qna: Array.isArray(current.qna) ? current.qna : [],
      },
      null,
    2),
    "",
    "[Transcript excerpt]",
    String(transcriptText || "").slice(0, REPORT_DENSITY_MAX_TRANSCRIPT_CHARS),
    "",
    "Requirement: keep the same keys and JSON schema, but make the content richer and denser while staying inside one-page scope.",
  ].join("\n");
}

async function ensureReportDensity(job, apiKey, report, transcriptText, preferredSummaryModel, usedModels) {
  if (!job || !apiKey || !report) return report;
  let current = report;
  const language = "en";

  for (let round = 1; round <= REPORT_DENSITY_REFINE_ROUNDS; round += 1) {
    if (isReportDenseEnough(current)) {
      return current;
    }

    logJob(
      job.id,
      "INFO",
      `요약 보강 라운드 ${round}/${REPORT_DENSITY_REFINE_ROUNDS}: 현재 길이 부족`
    );
    try {
      const result = await callResponsesWithModelFallback(
        apiKey,
        "seminar_report_refine",
        {
          type: "json_schema",
          name: "seminar_report",
          schema: reportSchema,
          strict: true,
        },
        buildDensityDeveloperPrompt(language),
        buildDensityPrompt(current, transcriptText),
        3600,
        preferredSummaryModel
      );
      usedModels.add(result.model);
      recordSummaryModelUsage(job, result.model);
      current = normalizeReportOutput(result.payload);
      logJob(job.id, "INFO", `요약 보강 완료(라운드 ${round}): ${result.model}`);
    } catch (error) {
      logJob(job.id, "WARN", `요약 보강 실패(라운드 ${round}, 스킵): ${String(error.message || error).slice(0, 140)}`);
      break;
    }
  }

  if (!isReportDenseEnough(current)) {
    logJob(job.id, "WARN", "요약이 여전히 짧습니다. 원문 내용 한계로 추가 보강 없이 진행합니다.");
  }
  return current;
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

async function callResponsesWithModelFallback(apiKey, schemaName, schemaConfig, developerPrompt, userPrompt, maxTokens, preferredModel) {
  let lastError = null;
  const candidateModels = [];
  const primary = resolveSummaryModel(preferredModel);
  candidateModels.push(primary);
  for (const model of SUMMARY_MODELS) {
    if (model !== primary) candidateModels.push(model);
  }

  for (const model of candidateModels) {
    try {
      const result = await callOpenAIResponses(apiKey, model, schemaName, schemaConfig, developerPrompt, userPrompt, maxTokens);
      logJob(appState.activeJobId, "INFO", `summary: completed with ${model}`);
      return { ...result, model };
    } catch (error) {
      lastError = error;
      logJob(appState.activeJobId, "WARN", `${model} summary 실패: ${String(error.message || error).slice(0, 120)}`);
    }
  }
  throw lastError || new Error("summary failed");
}

async function callOpenAIResponses(apiKey, model, schemaName, schemaConfig, developerPrompt, userPrompt, maxOutputTokens) {
  const normalizedSchema = schemaConfig && typeof schemaConfig === "object" && schemaConfig.schema
    ? schemaConfig.schema
    : schemaConfig;
  const normalizedSchemaName = schemaConfig && typeof schemaConfig === "object" && schemaConfig.name
    ? schemaConfig.name
    : schemaName;
  const normalizedStrict = schemaConfig && typeof schemaConfig === "object" && typeof schemaConfig.strict === "boolean"
    ? schemaConfig.strict
    : true;

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
        name: normalizedSchemaName,
        schema: normalizedSchema,
        strict: normalizedStrict,
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

function hasKoreanText(value) {
  return /[\uac00-\ud7af]/i.test(String(value || ""));
}

function sanitizeReportValueForPdf(value) {
  return sanitizeForPdf(String(value || ""));
}

function sanitizePdfReportText(report) {
  const safe = report && typeof report === "object" ? report : {};
  return {
    ...safe,
    summary_sentences: Array.isArray(safe.summary_sentences)
      ? safe.summary_sentences.map((item) => sanitizeReportValueForPdf(item)).filter(Boolean)
      : [],
    learning_sentence: sanitizeReportValueForPdf(safe.learning_sentence),
    qna: Array.isArray(safe.qna)
      ? safe.qna
          .map((pair) => ({
            question: sanitizeReportValueForPdf(pair?.question),
            answer: sanitizeReportValueForPdf(pair?.answer),
          }))
      .filter((pair) => pair.question || pair.answer)
      : [],
  };
}

function truncateReportForPdf(report, attemptIndex = 0) {
  const safeReport = sanitizePdfReportText(report);
  const idx = Math.max(
    0,
    Math.min(PDF_PDF_ATTEMPT_STAGES - 1, Number(attemptIndex) || 0)
  );
  const summaryLimit = PDF_SUMMARY_TRUNCATION_LIMITS[idx] || PDF_SUMMARY_TRUNCATION_LIMITS[PDF_SUMMARY_TRUNCATION_LIMITS.length - 1];
  const learningLimit = PDF_LEARNING_TRUNCATION_LIMITS[idx] || PDF_LEARNING_TRUNCATION_LIMITS[PDF_LEARNING_TRUNCATION_LIMITS.length - 1];
  const questionLimit = PDF_QA_QUESTION_TRUNCATION_LIMITS[idx] || PDF_QA_QUESTION_TRUNCATION_LIMITS[PDF_QA_QUESTION_TRUNCATION_LIMITS.length - 1];
  const answerLimit = PDF_QA_ANSWER_TRUNCATION_LIMITS[idx] || PDF_QA_ANSWER_TRUNCATION_LIMITS[PDF_QA_ANSWER_TRUNCATION_LIMITS.length - 1];

  return {
    ...safeReport,
    summary_sentences: Array.isArray(safeReport.summary_sentences)
      ? safeReport.summary_sentences.slice(0, 3).map((sentence) => truncateText(String(sentence || ""), summaryLimit))
      : [],
    learning_sentence: truncateText(String(safeReport.learning_sentence || ""), learningLimit),
    qna: Array.isArray(safeReport.qna)
      ? safeReport.qna.slice(0, 3).map((pair) => ({
          question: truncateText(String(pair?.question || ""), questionLimit),
          answer: truncateText(String(pair?.answer || ""), answerLimit),
        }))
      : [],
  };
}

function truncateText(value, maxChars) {
  const text = String(value || "");
  const limit = Math.max(1, Number(maxChars) || 0);
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function normalizeReportOutput(report) {
  const safe = report && typeof report === "object" ? report : {};
  const summary = Array.isArray(safe.summary_sentences)
    ? safe.summary_sentences
        .map((item) => truncateText(String(item || "").trim(), REPORT_MAX_SUMMARY_SENTENCE_CHARS))
        .filter(Boolean)
    : [];
  const qnaCache = new Set();
  const qna = Array.isArray(safe.qna)
    ? safe.qna.reduce((list, item) => {
        if (!item) return list;
        const question = String(item.question || "").trim();
        const answer = String(item.answer || "").trim();
        const fingerprint = `${question}||${answer}`;
        if (!question || !answer || qnaCache.has(fingerprint)) {
          return list;
        }
        qnaCache.add(fingerprint);
        list.push({
          question: truncateText(question, REPORT_MAX_QA_QUESTION_CHARS),
          answer: truncateText(answer, REPORT_MAX_QA_ANSWER_CHARS),
        });
        return list;
      }, [])
    : [];
  return {
    ...safe,
    summary_sentences: summary.slice(0, 3),
    learning_sentence: truncateText(String(safe.learning_sentence || ""), REPORT_MAX_LEARNING_CHARS),
    qna: qna.slice(0, 3),
  };
}

function uint8ToBinaryString(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

async function ensurePdfKoreanFont(jobId) {
  if (PDF_FONT.loaded) return true;
  if (PDF_FONT.failed) return false;
  if (PDF_FONT.loading) return PDF_FONT.loading;

  PDF_FONT.loading = (async () => {
    try {
      const { jsPDF } = window.jspdf;
      const response = await fetch(PDF_FONT.url, { method: "GET", mode: "cors", cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`Font fetch failed (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      if (!buffer || buffer.byteLength < 1024) {
        throw new Error("Font payload is too small");
      }

      const binary = uint8ToBinaryString(new Uint8Array(buffer));
      const tempDoc = new jsPDF({ unit: "mm", format: "a4" });
      tempDoc.addFileToVFS(PDF_FONT.file, btoa(binary));
      tempDoc.addFont(PDF_FONT.file, PDF_FONT.name, "normal");
      tempDoc.addFont(PDF_FONT.file, PDF_FONT.name, "bold");
      PDF_FONT.loaded = true;
      return true;
    } catch (error) {
      PDF_FONT.failed = true;
      if (jobId) {
        logJob(jobId, "WARN", `PDF 한글 폰트 로드 실패: ${String(error.message || error).slice(0, 120)}`);
      }
      return false;
    } finally {
      PDF_FONT.loading = null;
    }
  })();

  return PDF_FONT.loading;
}

async function renderReportPdf(job, report, presetId = "classic") {
  setStatus(job.id, "processing", "PDF 렌더링", 80, "페이지/레코드 배치");
  const preset = getOutputPreset(presetId);
  const style = preset.pdf;
  const safeJobDate = sanitizeReportValueForPdf(job.seminarDate);
  const safeStudentName = sanitizeReportValueForPdf(job.studentName);
  const safeStudentId = sanitizeReportValueForPdf(job.studentId);
  const safePresetLabel = sanitizeReportValueForPdf(`Template: ${preset.label || preset.id}`);
  const safeReportBase = sanitizePdfReportText(report);

  const needsKoreanFont = hasKoreanText(
    `${safeJobDate} ${safeStudentName} ${safeStudentId} ${safeReportBase.learning_sentence} ${(safeReportBase.summary_sentences || []).join(" ")} ${(safeReportBase.qna || [])
      .map((pair) => `${pair.question} ${pair.answer}`)
      .join(" ")}`
  );
  const useKoreanFont = needsKoreanFont ? await ensurePdfKoreanFont(job.id) : false;
  const baseFontFamily = useKoreanFont ? PDF_FONT.name : style.font;

  const buildPdfArtifact = (pdfReport, override) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const titleFontSize = Number(override?.titleSize) || style.titleSize;
    const headingFontSize = Number(override?.headingSize) || style.headingSize;
    const bodySize = Number(override?.bodySize) || style.bodySize;
    const leading = Number(override?.leadingMultiplier) || style.lineHeight || 1.35;
    const margin = style.margin;
    const maxWidth = style.maxWidth;
    const pageBottom = 290 - margin;
    const headingPrefix = style.headingPrefix || "1.";
    let y = 18;
    const lines = [];
    const safeSafeReport = sanitizePdfReportText(pdfReport);

    const line = (txt, size, textStyle = "normal", extraGap = 0) => {
      doc.setFontSize(size);
      doc.setFont(baseFontFamily, textStyle);
      const chunks = doc.splitTextToSize(String(txt), maxWidth);
      const rows = Array.isArray(chunks) ? chunks.length : 1;
      doc.text(chunks, margin, y);
      y += rows * (size * leading * 0.3528) + extraGap;
    };

    doc.setTextColor(32, 37, 64);
    line(`[Seminar Report] (${safeJobDate})`, titleFontSize, "bold");
    doc.setTextColor(68, 73, 95);
    line(`${sanitizeReportValueForPdf(formatDateLabel(job.seminarDate))} ${safeStudentName} (${safeStudentId})`, bodySize + 1.1);
    line(safePresetLabel, Math.max(8.6, bodySize - 1));
    y += 2;

    doc.setDrawColor(style.dividerColor);
    doc.line(margin, y, margin + maxWidth, y);
    y += 6;

    const sec1 = headingPrefix === "Ⅰ" ? "Ⅰ" : "1.";
    const sec2 = headingPrefix === "Ⅰ" ? "Ⅱ" : "2.";
    const sec3 = headingPrefix === "Ⅰ" ? "Ⅲ" : "3.";
    line(`${sec1} Summary`, headingFontSize, "bold");
    safeSafeReport.summary_sentences.forEach((sentence, index) => {
      line(`${String.fromCharCode(65 + index)}. ${sentence}`, bodySize);
    });
    y += 3;

    line(`${sec2} Learnings`, headingFontSize, "bold");
    line(`A. ${safeSafeReport.learning_sentence}`, bodySize);
    y += 3;

    line(`${sec3} QnA`, headingFontSize, "bold");
    (safeSafeReport.qna || []).slice(0, 3).forEach((pair, index) => {
      line(`${String.fromCharCode(65 + index)}. ${pair.question || ""}`, bodySize);
      line(`A. ${pair.answer || ""}`, bodySize);
      y += 1;
    });

    return {
      url: URL.createObjectURL(new Blob([doc.output("arraybuffer")], { type: "application/pdf" })),
      pageCount: doc.getNumberOfPages(),
      y,
    };
  };

  let best = null;
  let bestPages = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < PDF_PDF_ATTEMPT_STAGES; attempt += 1) {
    const candidate = truncateReportForPdf(safeReportBase, attempt);
    for (const fontSize of PDF_PREFERRED_FONT_SIZES) {
      const payload = buildPdfArtifact(candidate, {
        titleSize: style.titleSize,
        headingSize: Math.max(9.8, style.headingSize - attempt * 0.2),
        bodySize: Math.max(8.2, fontSize - attempt * 0.2),
        leadingMultiplier: style.lineHeight || 1.35,
      });

      const pages = payload.pageCount;
      if (pages < bestPages) {
        if (best?.url) {
          URL.revokeObjectURL(best.url);
        }
        best = payload;
        bestPages = pages;
      }
      if (pages <= 1) {
        logJob(job.id, "INFO", `pdf generated (${pages} page) attempt=${attempt}, font=${fontSize}`);
        setStatus(job.id, "processing", "완료", 100, "저장 완료");
        return {
          url: payload.url,
          mime: "application/pdf",
          createdAt: new Date().toISOString(),
          fileName: `seminar-report-${safeStudentId.replace(/[^A-Za-z0-9._-]/g, "_")}-${safeJobDate || "report"}-${preset.id}.pdf`,
          pageCount: pages,
          fitMode: "exact",
        };
      }
    }
  }

  if (!best) {
    throw new Error("pdf rendering failed");
  }

  logJob(job.id, "WARN", `pdf fallback rendered with ${bestPages} page(s); 1page 미도달`);
  setStatus(job.id, "processing", "완료", 100, "저장 완료");
  return {
    url: best.url,
    mime: "application/pdf",
    createdAt: new Date().toISOString(),
    fileName: `seminar-report-${safeStudentId.replace(/[^A-Za-z0-9._-]/g, "_")}-${safeJobDate || "report"}-${preset.id}.pdf`,
    pageCount: bestPages,
    fitMode: "fallback",
  };
}

function revokeJobDownloadUrls(job) {
  if (!job || !job.output) return;
  if (job.output?.mdUrl) {
    URL.revokeObjectURL(job.output.mdUrl);
    job.output.mdUrl = null;
  }
  if (job.output?.rawTranscriptUrl) {
    URL.revokeObjectURL(job.output.rawTranscriptUrl);
    job.output.rawTranscriptUrl = null;
  }
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
    const activeModel = getSummaryModelSummary(job);
    const activeSttModel = getSttModelSummary(job);
    liveMeta.textContent = `상태: ${job.stage}${liveDetail} · 진행률: ${job.progress.toFixed(1)}% · ${qtxt} · ${formatBytes(job.file.size)} · ${job.createdAt}${activityText} · 요약모델: ${activeModel} · STT모델: ${activeSttModel}`;
    if (Date.now() - appState.lastJobsRenderAt >= 1800) {
      appState.lastJobsRenderAt = Date.now();
      scheduleRender({ jobs: true, live: false });
    }
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
    const modelSummary = getSummaryModelSummary(job);
    const sttModelSummary = getSttModelSummary(job);
    const stageHasInlineDetail = typeof job.stage === "string" && job.stage.includes("(") && job.stage.includes(")");
    const stageText = job.progressDetail && !stageHasInlineDetail ? `${job.stage} (${job.progressDetail})` : job.stage;
    meta.textContent = `${job.studentId} · ${job.fileName} · ${formatBytes(job.file.size)} · 출력: ${preset.label} · 요약모델: ${modelSummary} · STT: ${sttModelSummary} · ${stageText}`;
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
      if (!job.output.mdUrl) {
        job.output.mdUrl = URL.createObjectURL(new Blob([job.output.md || ""], { type: "text/markdown;charset=utf-8" }));
      }
      a2.href = job.output.mdUrl;
      a2.download = `seminar-report-${job.studentId}-${job.seminarDate}-${getOutputPreset(job.outputPresetId).id}.md`;
      a2.className = "footer-link";
      a2.style.marginLeft = "8px";
      a2.textContent = "Markdown 다운로드";

      actions.appendChild(a1);
      actions.appendChild(a2);

      if (job.output?.rawTranscript) {
        if (!job.output.rawTranscriptUrl) {
          job.output.rawTranscriptUrl = URL.createObjectURL(
            new Blob([job.output.rawTranscript], { type: "text/plain;charset=utf-8" })
          );
        }
        const a3 = document.createElement("a");
        a3.href = job.output.rawTranscriptUrl;
        a3.download = `raw-transcript-${job.studentId}-${job.seminarDate}.txt`;
        a3.className = "footer-link";
        a3.style.marginLeft = "8px";
        a3.textContent = "Raw STT 다운로드";
        actions.appendChild(a3);
      }
    }

    card.appendChild(actions);

    const rawPreview = document.createElement("details");
    rawPreview.className = "job-raw-transcript";
    const rawSummary = document.createElement("summary");
    const sourceLen = job.output?.rawTranscriptPreDedupeLength || 0;
    rawSummary.textContent = `Raw STT 결과 (${job.output?.rawTranscriptLength || 0}자 / 원본 ${
      sourceLen ? `${sourceLen}자` : "미기록"
    })`;
    rawPreview.appendChild(rawSummary);
    const rawBody = document.createElement("pre");
    rawBody.className = "job-raw-transcript__text";
    rawBody.textContent = makeRawTranscriptDisplayText(job.output?.rawTranscript, RAW_TRANSCRIPT_PREVIEW_CHARS);
    rawPreview.appendChild(rawBody);
    card.appendChild(rawPreview);

    const log = document.createElement("div");
    renderJobLogSummary(log, job.logs, 3);
    card.appendChild(log);

    jobsList.appendChild(card);
  }

  if (appState.activeJobId) {
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

window.addEventListener("beforeunload", () => {
  for (const job of appState.jobs) {
    revokeJobDownloadUrls(job);
    if (job?.output?.pdf?.url) {
      URL.revokeObjectURL(job.output.pdf.url);
      job.output.pdf.url = null;
    }
  }
});
