import { Router } from "express";
import { resolveBudget } from "../agent/budget.js";
import { config } from "../config.js";
import { ASSET_TYPES } from "../domain/assetTypes.js";
import { SIZE_PRESETS } from "../image/sizes.js";
import { providers } from "../providers/index.js";

export const configRouter = Router();

configRouter.get("/api/config", (_req, res) => {
  res.json({
    providers: providers.map((p) => ({ id: p.id, label: p.label, available: p.available() })),
    assetTypes: ASSET_TYPES,
    sizePresets: SIZE_PRESETS,
    demo: config.demo,
    auth: !!config.accessToken,
    budget: resolveBudget(undefined),
  });
});
