/** REST client for translation, learning (documents + YouTube) and memory. */

export interface LearnedDocument {
  id: string;
  kind: string;
  title: string;
  url?: string;
  sourceLang: string;
  targetLang: string;
  characters: number;
  sentences: number;
  phrasesAdded: number;
  glossaryAdded: number;
  hotwordsAdded: number;
  createdAt: number;
  segments?: number;
  bilingualPairs?: number;
  videoId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryView {
  profile: string;
  version: number;
  stats: { phrases: number; learnedPhrases: number; glossary: number; documents: number; hotwords: number };
  documents: LearnedDocument[];
  glossary: Array<{ source: string; target: string }>;
  hotwords: Record<string, string[]>;
}

export interface LearnResponse {
  document: LearnedDocument;
  memory: MemoryView;
}

export interface TranslationResponse {
  text: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  engine: string;
  cached: boolean;
  confidence: number;
  coverage: number;
  glossaryHits: string[];
  latencyMs: number;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  engines: { translation: string; speechToText: string; textToSpeech: string };
}

export interface CapabilitiesResponse {
  protocolVersion: number;
  engines: { translation: string; speechToText: string; textToSpeech: string };
  capabilities: Record<string, unknown>;
}

export interface LearningClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface LearnOptions {
  sourceLang: string;
  targetLang: string;
  profile?: string;
  title?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export class LearningClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LearningClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      let detail: unknown = undefined;
      let message = `${response.status} ${response.statusText}`;
      try {
        detail = await response.json();
        if (detail && typeof detail === "object" && "detail" in detail) {
          message = String((detail as { detail: unknown }).detail);
        }
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(response.status, message, detail);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/v1/health");
  }

  async languages(): Promise<{ version: number; languages: unknown[] }> {
    return this.request("/v1/languages");
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    return this.request<CapabilitiesResponse>("/v1/capabilities");
  }

  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
    profile = "default",
  ): Promise<TranslationResponse> {
    return this.request<TranslationResponse>("/v1/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sourceLang, targetLang, profile }),
    });
  }

  async uploadDocument(file: Blob, filename: string, options: LearnOptions): Promise<LearnResponse> {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("sourceLang", options.sourceLang);
    form.append("targetLang", options.targetLang);
    form.append("profile", options.profile ?? "default");
    if (options.title) form.append("title", options.title);
    return this.request<LearnResponse>("/v1/learn/documents", { method: "POST", body: form });
  }

  async learnText(text: string, options: LearnOptions & { filename?: string }): Promise<LearnResponse> {
    return this.request<LearnResponse>("/v1/learn/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        filename: options.filename ?? "notes.txt",
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        profile: options.profile ?? "default",
        title: options.title ?? "",
      }),
    });
  }

  async learnYouTube(url: string, options: LearnOptions & { bilingual?: boolean }): Promise<LearnResponse> {
    return this.request<LearnResponse>("/v1/learn/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        profile: options.profile ?? "default",
        bilingual: options.bilingual ?? true,
      }),
    });
  }

  async memory(profile = "default"): Promise<MemoryView> {
    return this.request<MemoryView>(`/v1/memory/${encodeURIComponent(profile)}`);
  }

  async resetMemory(profile = "default"): Promise<MemoryView> {
    return this.request<MemoryView>(`/v1/memory/${encodeURIComponent(profile)}`, { method: "DELETE" });
  }

  async tts(text: string, language: string): Promise<ArrayBuffer> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    if (!response.ok) {
      throw new ApiError(response.status, `TTS failed: ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  async metrics(): Promise<Record<string, unknown>> {
    return this.request("/v1/metrics");
  }
}
