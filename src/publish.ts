import { Notice, type TFile, type Editor } from "obsidian";
import type AnkePlugin from "./main";
import { type Project } from "./library";
import {
  openingTag,
  segmentAt,
  timingTags,
  wrapSegment,
  type TimingTag,
} from "./document";
import { toBBCode } from "./export";
import { postReply, threadUrl, toNGABBCode } from "./nga";
import { eligible, sendRecorded, type JournalEntry } from "./publication";

export interface Pending {
  file: TFile;
  project: Project;
  tag: TimingTag;
}
export class Publisher {
  busy = false;
  previousTick = Date.now();
  constructor(readonly plugin: AnkePlugin) {}
  async pending(): Promise<Pending[]> {
    const result: Pending[] = [];
    for (const project of this.plugin.library.projects()) {
      for (const file of this.plugin.library.chapters(project)) {
        try {
          for (const tag of timingTags(await this.plugin.library.read(file)))
            result.push({ file, project, tag });
        } catch (error) {
          this.plugin.publishErrors.set(file.path, String(error));
          continue;
        }
        this.plugin.publishErrors.delete(file.path);
      }
    }
    return result;
  }
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const now = Date.now(),
      previous = this.previousTick;
    this.previousTick = now;
    try {
      // A second device may have changed the executor while this window stayed open.
      const disk = await this.plugin.loadData();
      if (disk?.executor !== this.plugin.deviceId) return;
      this.plugin.data.executor = disk.executor;
      Object.assign(this.plugin.data.journal, disk.journal);
      const pending = await this.pending();
      for (const item of pending) {
        const id = item.tag.attrs.task;
        const state = eligible(
          item.tag,
          this.plugin.data.journal,
          pending.filter((p) => p.tag.attrs.task === id).length,
          now,
          previous,
        );
        if (state === "wait") continue;
        if (state === "due") {
          try {
            await this.send(item);
          } catch (error) {
            if (!this.plugin.data.journal[id]) {
              this.plugin.data.journal[id] = {
                status: "failed",
                file: item.file.path,
                thread: item.project.thread,
                time: new Date().toISOString(),
                message: String(error),
              };
              await this.plugin.persist();
            }
            new Notice(String(error), 10000);
          }
        } else if (id) {
          this.plugin.data.journal[id] = {
            status: state,
            file: item.file.path,
            thread: item.project.thread,
            time: new Date().toISOString(),
            message:
              state === "missed"
                ? "Obsidian 关闭或休眠期间错过时间，请手动处理。"
                : "任务 ID 重复或发布时间无效，请修正后重新安排。",
          };
          await this.plugin.persist();
          new Notice(
            `安科发布：${this.plugin.data.journal[id].message}`,
            10000,
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async send(item: Pending): Promise<void> {
    const { plugin } = this,
      id = item.tag.attrs.task;
    if (!id || plugin.data.journal[id])
      throw new Error("该发布任务已经执行或需要处理，不能再次发送。");
    // Re-read immediately before sending: edits made since scheduling are authoritative.
    const all = await this.pending();
    const current = all.filter((p) => p.tag.attrs.task === id);
    if (current.length !== 1)
      throw new Error("任务标签丢失或重复，已停止发布。");
    item = current[0];
    const target = threadUrl(item.project.thread);
    const cookie = plugin.app.secretStorage.getSecret("anke-nga-cookie");
    if (!cookie) throw new Error("请在安科设置中保存 NGA Cookie。");
    const content = await toNGABBCode(item.tag.body);
    if (!content.trim()) throw new Error("空白分节不能发布。");
    // Image checks take time; do not send a stale section.
    const fresh = (await this.pending()).filter((p) => p.tag.attrs.task === id);
    if (
      fresh.length !== 1 ||
      fresh[0].file.path !== item.file.path ||
      fresh[0].tag.body !== item.tag.body ||
      JSON.stringify(fresh[0].tag.attrs) !== JSON.stringify(item.tag.attrs) ||
      threadUrl(fresh[0].project.thread) !== target
    )
      throw new Error(
        "核验期间正文、任务或绑定帖子已改变，已停止发布，请重新检查。",
      );
    const entry: JournalEntry = {
      status: "sending",
      file: item.file.path,
      thread: target,
      time: new Date().toISOString(),
      content,
      message: "发送中",
    };
    const receipt = await sendRecorded(
      plugin.data.journal,
      id,
      entry,
      () => plugin.persist(),
      () => postReply(target, content, cookie),
    );
    if (receipt.status === "sent") {
      try {
        await plugin.library.patch(item.file, (text) => {
          const tags = timingTags(text).filter((t) => t.attrs.task === id);
          if (tags.length !== 1)
            throw new Error("已发送，但标签已移动或复制；请在发布记录中核对。");
          const tag = tags[0];
          const attrs: Record<string, string> = {
            task: id,
            tid: new URL(target).searchParams.get("tid")!,
            sent: entry.time,
          };
          if (receipt.pid) attrs.pid = receipt.pid;
          if (receipt.floor) attrs.floor = receipt.floor;
          return (
            text.slice(0, tag.from) +
            openingTag(attrs) +
            text.slice(tag.openEnd)
          );
        });
      } catch (error) {
        new Notice(`已发送；回写标签失败：${String(error)}`, 10000);
      }
    }
    new Notice(`NGA：${receipt.message}`, 10000);
    plugin.refresh();
  }
  async publishCurrent(file: TFile, editor: Editor): Promise<void> {
    if (this.busy) throw new Error("正在执行其他发布任务，请稍后再试。");
    const project = this.plugin.library.chapterProject(file);
    if (!project) throw new Error("请先打开项目正文。");
    threadUrl(project.thread);
    if (!this.plugin.app.secretStorage.getSecret("anke-nga-cookie"))
      throw new Error("请先在插件设置中保存 NGA Cookie。");
    // Capture the clicked editor and cursor before any asynchronous work.
    const text = editor.getValue();
    const section = segmentAt(text, editor.posToOffset(editor.getCursor()));
    if (!toBBCode(text.slice(section.from, section.to)).trim())
      throw new Error("当前分节没有可发布内容。");
    this.busy = true;
    try {
      const task = crypto.randomUUID();
      await this.plugin.library.patch(file, (current) => {
        if (current !== text) throw new Error("正文已改变，请重新点击发布。");
        return (
          current.slice(0, section.from) +
          wrapSegment(current, section, { task }) +
          current.slice(section.to)
        );
      });
      const tag = timingTags(await this.plugin.library.read(file)).find(
        (t) => t.attrs.task === task,
      );
      if (!tag)
        throw new Error("当前分节的发布标签已改变，请在发布记录中检查。");
      await this.send({ file, project, tag });
    } finally {
      this.busy = false;
    }
  }
}
