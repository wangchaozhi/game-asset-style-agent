import { gemini } from "./gemini.js";
import { mock } from "./mock.js";
import { openai } from "./openai.js";
import { sdwebui } from "./sdwebui.js";
import type { ImageProvider } from "./types.js";

export * from "./types.js";

export const providers: ImageProvider[] = [openai, gemini, sdwebui, mock];

/** The named provider (must be configured), or the first available one. */
export function getProvider(id: string | undefined): ImageProvider {
  const chosen = providers.find((p) => p.id === id);
  if (chosen) {
    if (!chosen.available()) throw new Error(`图像通道 ${chosen.label} 未配置 API key`);
    return chosen;
  }
  return providers.find((p) => p.available())!;
}
