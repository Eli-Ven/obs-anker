import type { TimingTag } from "./document";
import type { Receipt } from "./nga";

export interface JournalEntry {
  status: "sending" | "sent" | "unknown" | "failed" | "missed" | "blocked";
  file: string;
  thread: string;
  time: string;
  content?: string;
  message: string;
  pid?: string;
  floor?: string;
}
export type Journal = Record<string, JournalEntry>;
export function eligible(
  tag: TimingTag,
  journal: Journal,
  count: number,
  now: number,
  previousTick: number,
): "wait" | "due" | "missed" | "blocked" {
  if (
    !tag.attrs.time ||
    tag.attrs.pid ||
    tag.attrs.sent ||
    tag.attrs.marked ||
    journal[tag.attrs.task]
  )
    return "wait";
  if (
    !tag.attrs.task ||
    count !== 1 ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(tag.attrs.time) ||
    !Number.isFinite(Date.parse(tag.attrs.time))
  )
    return "blocked";
  const due = Date.parse(tag.attrs.time);
  if (due > now) return "wait";
  return due < previousTick || now - previousTick > 60000 ? "missed" : "due";
}

export async function sendRecorded(
  journal: Journal,
  id: string,
  entry: JournalEntry,
  persist: () => Promise<void>,
  send: () => Promise<Receipt>,
): Promise<Receipt> {
  if (journal[id]) throw new Error("任务已经执行过；不能重复发布。");
  journal[id] = entry;
  await persist();
  let receipt: Receipt;
  try {
    receipt = await send();
  } catch {
    receipt = {
      status: "unknown",
      message: "发送结果不确定，请核对；不会自动重发。",
    };
  }
  Object.assign(entry, receipt);
  await persist();
  return receipt;
}
