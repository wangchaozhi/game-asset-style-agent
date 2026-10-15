import fs from "node:fs/promises";
import path from "node:path";
import type { Conversation } from "./types.js";
import { projectDir, readJson, writeAtomic } from "./fs.js";

// Agent conversation: append-only history per project.
const convFile = (id: string) => path.join(projectDir(id), "conversation.json");

export const loadConversation = (id: string) => readJson<Conversation>(convFile(id));

export async function saveConversation(id: string, conv: Conversation): Promise<number> {
  const json = JSON.stringify(conv);
  await writeAtomic(convFile(id), json);
  return json.length;
}

export async function clearConversation(id: string) {
  await fs.rm(convFile(id), { force: true });
}

export async function conversationSize(id: string): Promise<number> {
  return fs.stat(convFile(id)).then((s) => s.size, () => 0);
}
