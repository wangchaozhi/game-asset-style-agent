export type Aspect = "square" | "landscape" | "portrait";

export interface ImageInput {
  data: Buffer;
  mime: string;
}

export interface GenerateRequest {
  prompt: string;
  references: ImageInput[];
  aspect: Aspect;
  transparent: boolean;
  /** sprite sheets: number of frames laid out in one row */
  frames?: number;
  /** told before each retry of a rate-limited or failed request */
  onRetry?: (info: import("./retry.js").RetryInfo) => void;
}

export interface ImageProvider {
  id: string;
  label: string;
  available: () => boolean;
  generate: (req: GenerateRequest, signal?: AbortSignal) => Promise<ImageInput>;
}

export async function failOnHttpError(res: Response, who: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${who} HTTP ${res.status}: ${body.slice(0, 500)}`);
}
