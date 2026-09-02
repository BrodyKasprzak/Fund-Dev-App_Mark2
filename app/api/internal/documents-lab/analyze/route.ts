import { NextResponse } from "next/server";
import { requireDocumentReadAccess, errorToResponse } from "@/lib/serverAuth";
import { enforceRateLimit, getRequestIp, RateLimitError } from "@/lib/rateLimit";
import { lexicalEditorStateFromHtmlPhaseA } from "@/lib/documents/lexicalImportFromHtml";
import { derivePlainTextFromLexicalEditorState } from "@/lib/documents/lexicalPlainText";

export const runtime = "nodejs";

const ANALYZE_LIMIT_PER_10_MIN = 80;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 10;
const MAX_PREVIEW_CHARS = 2_500;

type SupportedType = "docx" | "pdf";

type AnalyzeFileSuccess = {
  status: "ok";
  fileName: string;
  fileType: string;
  size: number;
  detectedType: SupportedType;
  durationMs: number;
  summary: {
    textLength: number;
    preview: string;
    warnings: string[];
  };
  docx?: {
    htmlLength: number;
    editorStateBytes: number | null;
    importSummary: {
      mappedFeatures: string[];
      downgradedFeatures: string[];
      fallbackUsed: boolean;
    };
  };
  pdf?: {
    pageCount: number | null;
    metadataTitle: string | null;
    metadataProducer: string | null;
  };
};

type AnalyzeFileFailure = {
  status: "error";
  fileName: string;
  fileType: string;
  size: number;
  detectedType: SupportedType | "unsupported";
  durationMs: number;
  error: string;
};

function isDocxMime(type: string) {
  return type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isPdfMime(type: string) {
  return type === "application/pdf";
}

function detectSupportedType(name: string, mime: string): SupportedType | "unsupported" {
  const lowerName = name.trim().toLowerCase();
  const normalizedMime = mime.trim().toLowerCase();
  if (isDocxMime(normalizedMime) || lowerName.endsWith(".docx")) return "docx";
  if (isPdfMime(normalizedMime) || lowerName.endsWith(".pdf")) return "pdf";
  return "unsupported";
}

function previewText(raw: string) {
  return raw.replace(/\r\n/g, "\n").trim().slice(0, MAX_PREVIEW_CHARS);
}

async function analyzeDocx(buffer: Buffer) {
  const mammothModule = await import("mammoth");
  const mammoth = (mammothModule.default ?? mammothModule) as {
    convertToHtml: (
      input: { buffer: Buffer },
      options?: { styleMap?: string[] },
    ) => Promise<{ value?: string }>;
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
  };

  const parsed = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Title'] => h1:fresh",
        "b => strong",
        "i => em",
        "u => u",
        "strike => s",
      ],
    },
  );
  const html = typeof parsed.value === "string" ? parsed.value.trim() : "";
  const phaseA = lexicalEditorStateFromHtmlPhaseA(html);

  const warnings: string[] = [];
  let text = "";
  let editorStateBytes: number | null = null;
  let fallbackUsed = false;

  if (phaseA.editorState) {
    const serialized = JSON.stringify(phaseA.editorState);
    editorStateBytes = Buffer.byteLength(serialized, "utf8");
    text = derivePlainTextFromLexicalEditorState(phaseA.editorState, 200_000);
  } else {
    fallbackUsed = true;
    warnings.push("Phase-A lexical import returned no editor state; used raw text fallback.");
    const rawText = await mammoth.extractRawText({ buffer });
    text = typeof rawText.value === "string" ? rawText.value : "";
  }

  if (phaseA.summary.downgradedFeatures.length > 0) {
    warnings.push(
      `${phaseA.summary.downgradedFeatures.length} downgraded feature(s) detected during import.`,
    );
  }

  return {
    htmlLength: html.length,
    text,
    warnings,
    editorStateBytes,
    importSummary: {
      mappedFeatures: phaseA.summary.mappedFeatures,
      downgradedFeatures: phaseA.summary.downgradedFeatures,
      fallbackUsed,
    },
  };
}

async function analyzePdf(buffer: Buffer) {
  const pdfModule = await import("pdf-parse");
  const parsePdf = (pdfModule.default ?? pdfModule) as (
    dataBuffer: Buffer,
  ) => Promise<{
    text?: string;
    numpages?: number;
    info?: { Title?: string; Producer?: string };
  }>;
  const parsed = await parsePdf(buffer);
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const warnings: string[] = [];

  if (!text.trim()) {
    warnings.push("No extractable text found. This may be image-only/scanned PDF (OCR needed).");
  }

  return {
    text,
    warnings,
    pageCount: typeof parsed.numpages === "number" ? parsed.numpages : null,
    metadataTitle:
      typeof parsed.info?.Title === "string" && parsed.info.Title.trim()
        ? parsed.info.Title.trim().slice(0, 200)
        : null,
    metadataProducer:
      typeof parsed.info?.Producer === "string" && parsed.info.Producer.trim()
        ? parsed.info.Producer.trim().slice(0, 200)
        : null,
  };
}

export async function POST(req: Request) {
  try {
    const { orgId, uid } = await requireDocumentReadAccess(req);
    await enforceRateLimit({
      scope: "documents_lab_analyze_user",
      key: `${orgId}:${uid}`,
      limit: ANALYZE_LIMIT_PER_10_MIN,
      windowMs: 10 * 60 * 1000,
    });
    await enforceRateLimit({
      scope: "documents_lab_analyze_ip",
      key: getRequestIp(req),
      limit: ANALYZE_LIMIT_PER_10_MIN * 2,
      windowMs: 10 * 60 * 1000,
    });

    const form = await req.formData();
    const fileEntries = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }
    if (fileEntries.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many files. Max is ${MAX_FILES_PER_REQUEST} per request.` },
        { status: 400 },
      );
    }

    const results: Array<AnalyzeFileSuccess | AnalyzeFileFailure> = [];

    for (const file of fileEntries) {
      const started = Date.now();
      const fileType = (file.type || "application/octet-stream").trim().toLowerCase();
      const detectedType = detectSupportedType(file.name, fileType);
      const size = file.size;

      if (size <= 0 || size > MAX_FILE_BYTES) {
        results.push({
          status: "error",
          fileName: file.name,
          fileType,
          size,
          detectedType,
          durationMs: Date.now() - started,
          error: `File must be between 1 byte and ${MAX_FILE_BYTES} bytes.`,
        });
        continue;
      }

      if (detectedType === "unsupported") {
        results.push({
          status: "error",
          fileName: file.name,
          fileType,
          size,
          detectedType,
          durationMs: Date.now() - started,
          error: "Unsupported format. Upload DOCX or PDF.",
        });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());

        if (detectedType === "docx") {
          const docx = await analyzeDocx(buffer);
          results.push({
            status: "ok",
            fileName: file.name,
            fileType,
            size,
            detectedType,
            durationMs: Date.now() - started,
            summary: {
              textLength: docx.text.length,
              preview: previewText(docx.text),
              warnings: docx.warnings,
            },
            docx: {
              htmlLength: docx.htmlLength,
              editorStateBytes: docx.editorStateBytes,
              importSummary: docx.importSummary,
            },
          });
          continue;
        }

        const pdf = await analyzePdf(buffer);
        results.push({
          status: "ok",
          fileName: file.name,
          fileType,
          size,
          detectedType,
          durationMs: Date.now() - started,
          summary: {
            textLength: pdf.text.length,
            preview: previewText(pdf.text),
            warnings: pdf.warnings,
          },
          pdf: {
            pageCount: pdf.pageCount,
            metadataTitle: pdf.metadataTitle,
            metadataProducer: pdf.metadataProducer,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown analysis error";
        results.push({
          status: "error",
          fileName: file.name,
          fileType,
          size,
          detectedType,
          durationMs: Date.now() - started,
          error: message.slice(0, 300),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      analyzedAt: new Date().toISOString(),
      resultCount: results.length,
      results,
    });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }
    const { status, message } = errorToResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
