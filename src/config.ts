import path from "node:path";

/** Settings read from the environment. Read lazily so tests can set env vars before use. */
export const config = {
  get model() {
    return process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  },
  get effort() {
    return (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
  },
  get maxTurns() {
    return Number(process.env.AGENT_MAX_TURNS ?? 40);
  },
  /** Past this size a project starts a fresh conversation so requests stay well under the API's size limit. */
  get conversationLimitBytes() {
    return Number(process.env.CONVERSATION_LIMIT_MB ?? 12) * 1024 * 1024;
  },
  get demo() {
    return process.env.AGENT_MODE === "demo";
  },
  get dataDir() {
    return path.resolve(process.env.DATA_DIR ?? "data");
  },
  /** When set, every page and API call requires logging in with this token. */
  get accessToken() {
    return process.env.ACCESS_TOKEN?.trim() || null;
  },
  get port() {
    return Number(process.env.PORT ?? 5173);
  },
};
