export interface PaletteColor {
  hex: string;
  role: string;
}

export interface StyleGuide {
  summary: string;
  palette: PaletteColor[];
  rendering: string;
  line_and_edges: string;
  lighting_and_shading: string;
  perspective: string;
  proportions: string;
  texture_and_detail: string;
  mood: string;
  avoid: string[];
  prompt_prefix: string;
}

export interface RefImage {
  id: string;
  file: string; // relative to project dir
  mime: string;
  originalName: string;
}

export type AssetStatus = "pending_review" | "approved" | "rejected";

export interface Asset {
  id: string;
  name: string;
  assetType: string;
  prompt: string;
  file: string; // relative to project dir
  mime: string;
  status: AssetStatus;
  score?: number;
  notes?: string;
  runId: string;
  provider: string;
  createdAt: string;
  /** sprite_sheet only: sliced frame files and GIF preview, relative to project dir */
  frames?: string[];
  gif?: string;
  fps?: number;
  /** set once the background has been cut out; the untouched model output */
  originalFile?: string;
  /** previous version this asset was redrawn from */
  parentId?: string;
  reviewer?: "agent" | "user";
  /** palette consistency, measured against the style guide when the asset was made */
  palette?: { coverage: number; meanDeltaE: number; offPalette: { hex: string; share: number }[] };
}

export type TrashedAsset = Asset & { deletedAt: string };

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  refs: RefImage[];
  styleGuide: StyleGuide | null;
  assets: Asset[];
  /** deleted assets, kept with their files until restored or purged */
  trash?: TrashedAsset[];
}

export interface Conversation {
  /** Raw Messages API params, exactly as sent/received. Never edited, only appended to. */
  messages: unknown[];
  runs: { request: string; at: string }[];
}
