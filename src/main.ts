import {
  MarkdownRenderChild,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  type Editor,
  type MarkdownFileInfo,
  type WorkspaceParent,
} from "obsidian";
import { Library, validName, type Character, type Project } from "./library";
import { CharacterView, VIEW_TYPE } from "./view";
import { VariantSearch, type VariantChoice } from "./variant-search";
import {
  dialogueChanges,
  segmentAt,
  timingTags,
  wrapSegment,
  type Variant,
} from "./document";
import { fullwidthPunctuation } from "./fullwidth";
import { editorExtensions } from "./editor";
import { Publisher } from "./publish";
import {
  recordUse,
  resetBoost,
  type VariantUsageStore,
} from "./variant-ranking";
import type { Journal } from "./publication";
import { prepareReply, threadUrl, toNGABBCode } from "./nga";
import { Form, Pick, report, run } from "./ui";

interface PluginData {
  compact: boolean;
  characterHeight: number;
  chapterPattern: string;
  characterFolderName: string;
  collapsedGroups: string[];
  variantUsage: VariantUsageStore;
  executor: string;
  journal: Journal;
}
const defaults: PluginData = {
  compact: true,
  characterHeight: 50,
  chapterPattern: /^\d+-\d+/.source,
  characterFolderName: "角色",
  collapsedGroups: [],
  variantUsage: {},
  executor: "",
  journal: {},
};
export default class AnkePlugin extends Plugin {
  data!: PluginData;
  library!: Library;
  publisher!: Publisher;
  deviceId = "";
  publishErrors = new Map<string, string>();
  private saveQueue = Promise.resolve();
  private refreshTimer?: number;
  private targets = new Map<Window, MarkdownView>();
  error = report;
  async onload(): Promise<void> {
    this.data = { ...defaults, variantUsage: {}, ...(await this.loadData()) };
    this.library = new Library(
      this.app,
      new RegExp(this.data.chapterPattern),
      this.data.characterFolderName,
    );
    this.publisher = new Publisher(this);
    const key = "anke-device-id";
    this.deviceId = this.app.loadLocalStorage(key) || crypto.randomUUID();
    this.app.saveLocalStorage(key, this.deviceId);
    for (const entry of Object.values(this.data.journal))
      if (entry.status === "sending") {
        entry.status = "unknown";
        entry.message = "Obsidian 在发送期间退出，请先到帖子核对。";
      }
    await this.persist();
    this.registerView(VIEW_TYPE, (leaf) => new CharacterView(leaf, this));
    this.registerEditorExtension(editorExtensions(this));
    this.addRibbonIcon("book-open-text", this.manifest.name, () =>
      run(() => this.openCharacters()),
    );
    this.addCommand({
      id: "open-characters",
      name: "打开角色侧边栏",
      callback: () => run(() => this.openCharacters()),
    });
    this.addCommand({
      id: "close-characters",
      name: "关闭角色侧边栏",
      callback: () => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))
          leaf.detach();
      },
    });
    this.addCommand({
      id: "create-project",
      name: "创建写作项目",
      callback: () => this.newProject(),
    });
    this.addCommand({
      id: "anke-init",
      name: "anke init",
      callback: () => this.initFolder(),
    });
    this.addCommand({
      id: "migrate-character",
      name: "合并旧版角色为单文件",
      callback: () => {
        const choices = this.library.projects().flatMap((project) =>
          this.library
            .characters(project, false)
            .filter((c) => this.library.isLegacy(c))
            .map((character) => ({ project, character })),
        );
        if (!choices.length) {
          new Notice("没有需要合并的旧版角色。");
          return;
        }
        new Pick(
          this.app,
          choices,
          (row) => `${row.project.name} / ${row.character.name}`,
          (row) => this.migrateCharacter(row.project, row.character),
          "选择要合并的角色",
        ).open();
      },
    });
    this.addCommand({
      id: "search-variants",
      name: "搜索角色／分组／差分并插入",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "P" }],
      editorCheckCallback: (checking, editor, info) => {
        const project = this.isWriting(info);
        if (!project) return false;
        if (!checking) run(() => this.searchVariants(project, editor, info));
        return true;
      },
    });
    this.addCommand({
      id: "insert-nga-dice",
      name: "插入 NGA 骰子",
      // Uppercase also matches Obsidian's virtual key when macOS Option emits ∂.
      hotkeys: [{ modifiers: ["Alt"], key: "D" }],
      editorCheckCallback: (checking, editor, info) => {
        if (!this.isWriting(info)) return false;
        if (!checking) {
          const from = editor.getCursor("from"),
            to = editor.getCursor("to"),
            offset = editor.posToOffset(from),
            insert = "[dice]1d100[/dice]";
          const newText =
            editor.getValue().slice(0, offset) +
            insert +
            editor.getValue().slice(editor.posToOffset(to));
          const prefix = newText.slice(0, offset + 11).split("\n");
          editor.transaction({
            changes: [{ from, to, text: insert }],
            selection: {
              from: { line: prefix.length - 1, ch: prefix.at(-1)!.length },
            },
          });
        }
        return true;
      },
    });
    for (let index = 0; index < 3; index++)
      this.addCommand({
        id: `character-color-${index + 1}`,
        name: `使用第 ${index + 1} 位角色的对白颜色`,
        hotkeys: [{ modifiers: ["Alt"], key: String(index + 1) }],
        editorCheckCallback: (checking, editor, info) => {
          const project = this.isWriting(info);
          if (!project) return false;
          if (!checking) {
            try {
              const character = this.library.characters(project)[index];
              if (!character)
                throw new Error(`项目没有第 ${index + 1} 位可见角色。`);
              let from = editor.posToOffset(editor.getCursor("from")),
                to = editor.posToOffset(editor.getCursor("to"));
              if (from === to) {
                const line = editor.getCursor().line;
                from = editor.posToOffset({ line, ch: 0 });
                to = from + editor.getLine(line).length;
              }
              const changes = dialogueChanges(
                editor.getValue(),
                from,
                to,
                character.color,
              );
              editor.transaction(
                {
                  changes: changes.map((c) => ({
                    from: editor.offsetToPos(c.from),
                    to: editor.offsetToPos(c.to),
                    text: c.insert,
                  })),
                },
                "anke.color",
              );
              const owner =
                info instanceof MarkdownView
                  ? info.containerEl.ownerDocument
                  : activeDocument;
              for (const view of this.views())
                if (view.containerEl.ownerDocument === owner)
                  view.select(character);
              if (!changes.length) new Notice("当前范围里没有成对的引号。");
            } catch (error) {
              report(error);
            }
          }
          return true;
        },
      });
    this.addCommand({
      id: "halfwidth-to-fullwidth",
      name: "半角->全角",
      editorCallback: (editor) => {
        const text = editor.getValue();
        const ranges = editor
          .listSelections()
          .map(({ anchor, head }) => {
            const a = editor.posToOffset(anchor),
              b = editor.posToOffset(head);
            return { from: Math.min(a, b), to: Math.max(a, b) };
          })
          .filter(({ from, to }) => from !== to);
        if (!ranges.length) ranges.push({ from: 0, to: text.length });
        const changes = ranges.flatMap(({ from, to }) => {
          const original = text.slice(from, to);
          const converted = fullwidthPunctuation(original);
          return converted === original
            ? []
            : [
                {
                  from: editor.offsetToPos(from),
                  to: editor.offsetToPos(to),
                  text: converted,
                },
              ];
        });
        if (changes.length) editor.transaction({ changes });
        else new Notice("当前范围没有需要转换的标点或空格。");
      },
    });
    this.addCommand({
      id: "copy-nga-bbcode",
      name: "复制选区／当前分节为 NGA BBCode",
      hotkeys: [{ modifiers: ["Alt"], key: "C" }],
      editorCheckCallback: (checking, editor, info) => {
        if (!this.isWriting(info)) return false;
        if (!checking)
          run(async () => {
            const text = editor.getValue(),
              segment = segmentAt(text, editor.posToOffset(editor.getCursor()));
            const result = await toNGABBCode(
              editor.somethingSelected()
                ? editor.getSelection()
                : text.slice(segment.from, segment.to),
            );
            await navigator.clipboard.writeText(result);
            new Notice("已复制 NGA BBCode。");
          });
        return true;
      },
    });
    this.addCommand({
      id: "schedule-section",
      name: "设置自动发布（当前分节）",
      editorCheckCallback: (checking, editor, info) => {
        if (!this.isWriting(info) || !info.file) return false;
        if (!checking) this.schedule(info.file, editor);
        return true;
      },
    });
    this.addCommand({
      id: "publish-current-section",
      name: "发布当前分节",
      editorCheckCallback: (checking, editor, info) => {
        if (!this.isWriting(info) || !info.file) return false;
        if (!checking)
          run(() => this.publisher.publishCurrent(info.file!, editor));
        return true;
      },
    });
    this.addCommand({
      id: "bind-thread",
      name: "绑定 NGA 帖子",
      checkCallback: (checking) => {
        const project = this.library.projectFor(
          this.app.workspace.getActiveFile(),
        );
        if (!project) return false;
        if (!checking) this.bindThread(project);
        return true;
      },
    });
    this.addSettingTab(new AnkeSettings(this));
    this.registerMarkdownPostProcessor((element, context) => {
      const file = this.app.vault.getFileByPath(context.sourcePath);
      if (!file || !this.library.projectFor(file)) return;
      const type =
        this.app.metadataCache.getFileCache(file)?.frontmatter?.["anke-type"];
      if (type === "character") {
        const renderImages = () => {
          if (
            !element.closest(".markdown-reading-view") ||
            element.closest(".markdown-embed")
          )
            return;
          const section = context.getSectionInfo(element);
          if (!section) return;
          const entries = this.library.imageEntries(
            section.text
              .split("\n")
              .slice(section.lineStart, section.lineEnd + 1)
              .join("\n"),
            file,
          );
          for (const link of Array.from(
            element.querySelectorAll<HTMLAnchorElement>(
              "li > a, li > p > a, p > a",
            ),
          )) {
            if (link.querySelector(".anke-reading-image")) continue;
            const before = link.previousSibling;
            const after = link.nextSibling;
            const prefix =
              before?.nodeType === 3
                ? before.textContent!.split(/\r?\n/).at(-1)!
                : "";
            if (prefix.trim() && !/[:：][ \t]*$/.test(prefix)) continue;
            if (
              after?.nodeType === 3 &&
              after.textContent!.split(/\r?\n/)[0].trim()
            )
              continue;
            const label = /[:：][ \t]*$/.test(prefix)
              ? prefix.replace(/[:：][ \t]*$/, "").trim()
              : link.textContent || "";
            const url =
              link.getAttribute("data-href") || link.getAttribute("href") || "";
            if (
              !entries.some(
                (entry) =>
                  entry.url === url && (entry.label === label || !entry.label),
              )
            )
              continue;
            try {
              const img = element.ownerDocument.createElement("img");
              img.src = this.library.resolveMedia(url, file);
              img.alt = label;
              img.referrerPolicy = "no-referrer";
              img.loading = "lazy";
              img.className = "anke-reading-image";
              link.prepend(img);
            } catch {
              /* Keep the original link when its local image is missing. */
            }
          }
        };
        const child = new MarkdownRenderChild(element);
        child.onload = () => {
          child.register(element.onNodeInserted(renderImages, true));
          renderImages();
        };
        context.addChild(child);
        return;
      }
      if (!this.library.chapterProject(file)) return;
      const doc = element.ownerDocument,
        walker = doc.createTreeWalker(element, 4),
        nodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.parentElement?.closest("code, pre, a")) nodes.push(node);
      }
      let color = "";
      for (const node of nodes) {
        const pattern =
          /\[color=([a-z]+|#[a-f\d]{3,8})\]|\[\/color\]|\[dice\](\d+d\d+)\[\/dice\]/gi;
        const text = node.data,
          fragment = doc.createDocumentFragment();
        let from = 0;
        const append = (value: string) => {
          if (!value) return;
          if (color) {
            const span = doc.createElement("span");
            span.style.color = color;
            span.textContent = value;
            fragment.append(span);
          } else fragment.append(doc.createTextNode(value));
        };
        for (const match of text.matchAll(pattern)) {
          append(text.slice(from, match.index));
          if (match[1]) color = match[1];
          else if (match[2]) {
            const span = doc.createElement("span");
            span.className = "anke-badge";
            span.textContent = `NGA 🎲 ${match[2]}`;
            fragment.append(span);
          } else color = "";
          from = match.index! + match[0].length;
        }
        append(text.slice(from));
        node.replaceWith(fragment);
      }
    });
    const followActiveFile = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && this.isWriting(view))
        this.targets.set(view.containerEl.ownerDocument.defaultView!, view);
      this.refresh();
    };
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", followActiveFile),
    );
    this.registerEvent(this.app.workspace.on("file-open", followActiveFile));
    this.registerEvent(this.app.metadataCache.on("changed", followActiveFile));
    this.registerEvent(
      this.app.metadataCache.on("deleted", () => this.refresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () =>
        this.app.workspace.updateOptions(),
      ),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        let changed = false;
        for (const view of this.views())
          if (
            view.characterPath === oldPath ||
            view.characterPath.startsWith(oldPath + "/")
          )
            view.characterPath =
              file.path + view.characterPath.slice(oldPath.length);
        for (const entry of Object.values(this.data.journal)) {
          if (entry.file === oldPath || entry.file.startsWith(oldPath + "/")) {
            entry.file = file.path + entry.file.slice(oldPath.length);
            changed = true;
          }
        }
        this.data.collapsedGroups = this.data.collapsedGroups.map((path) => {
          if (
            path !== oldPath &&
            !path.startsWith(oldPath + "/") &&
            !path.startsWith(oldPath + "#")
          )
            return path;
          changed = true;
          return file.path + path.slice(oldPath.length);
        });
        for (const [path, usage] of Object.entries(this.data.variantUsage)) {
          if (path === oldPath || path.startsWith(oldPath + "/")) {
            this.data.variantUsage[file.path + path.slice(oldPath.length)] =
              usage;
            delete this.data.variantUsage[path];
            changed = true;
          }
        }
        if (changed) run(() => this.persist());
        this.refresh();
      }),
    );
    this.registerInterval(
      window.setInterval(() => {
        run(() => this.publisher.tick());
      }, 10000),
    );
    this.app.workspace.onLayoutReady(() => {
      followActiveFile();
      run(() => this.publisher.tick());
    });
    const status = this.addStatusBarItem();
    status.setText("安科 · 发布当前分节");
    status.addClass("mod-clickable");
    this.registerDomEvent(status, "click", () =>
      run(async () => {
        const { file, editor } = this.currentWritingEditor(
          this.app.workspace.rootSplit,
        );
        await this.publisher.publishCurrent(file, editor);
      }),
    );
  }
  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
  }
  persist(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.saveData(snapshot));
    return this.saveQueue;
  }
  recordVariantUse(file: TFile, url: string): void {
    const usage = (this.data.variantUsage[file.path] ??= {});
    usage[url] = recordUse(usage[url], Date.now());
    run(() => this.persist());
  }
  async acceptVariantOrder(file: TFile, urls: string[]): Promise<void> {
    const usage = this.data.variantUsage[file.path];
    if (usage) resetBoost(usage, urls);
    for (const view of this.views()) view.resetUsageBoost(file, urls);
    await this.persist();
  }
  async setChapterPattern(pattern: string): Promise<void> {
    if (!pattern.trim()) throw new Error("正文文件名正则不能为空。");
    const compiled = new RegExp(pattern);
    this.data.chapterPattern = pattern;
    this.library.chapterPattern = compiled;
    await this.persist();
    this.refreshWritingOptions();
  }
  async setCharacterFolderName(name: string): Promise<void> {
    validName(name);
    if (name.startsWith("."))
      throw new Error(
        "角色文件夹名称不能以点开头，Obsidian 不会索引隐藏目录。",
      );
    this.data.characterFolderName = name;
    this.library.characterFolderName = name;
    await this.persist();
    this.refreshWritingOptions();
  }
  private refreshWritingOptions(): void {
    this.app.workspace.updateOptions();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown"))
      if (leaf.view instanceof MarkdownView)
        leaf.view.previewMode.rerender(true);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && this.isWriting(view))
      this.targets.set(view.containerEl.ownerDocument.defaultView!, view);
    this.refresh();
  }
  refresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      for (const view of this.views()) run(() => view.render());
    }, 200);
  }
  views(): CharacterView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((l) => l.view as CharacterView);
  }
  isWriting(info: MarkdownFileInfo): Project | undefined {
    return this.library.chapterProject(info.file);
  }
  async openCharacters(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeftLeaf(true);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  newProject(): void {
    new Form(
      this.app,
      "新建写作项目",
      [{ key: "name", label: "项目名称" }],
      async (values) => {
        const file = await this.library.createProject(values.name);
        await this.app.workspace.getLeaf("tab").openFile(file);
        await this.openCharacters();
      },
    ).open();
  }
  initFolder(): void {
    const current = this.app.workspace.getActiveFile()?.parent;
    const folders = this.app.vault
      .getAllFolders()
      .sort((a, b) =>
        a === current
          ? -1
          : b === current
            ? 1
            : a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
      );
    if (!folders.length) {
      new Notice("请先在 Vault 内创建一个作品文件夹。");
      return;
    }
    new Pick(
      this.app,
      folders,
      (folder) => folder.path,
      (folder) =>
        run(async () => {
          const { file, created } = await this.library.initProject(folder);
          const existing = this.app.workspace
            .getLeavesOfType("markdown")
            .find(
              (leaf) =>
                leaf.view instanceof MarkdownView && leaf.view.file === file,
            );
          if (existing) await this.app.workspace.revealLeaf(existing);
          else await this.app.workspace.getLeaf("tab").openFile(file);
          await this.openCharacters();
          new Notice(
            created
              ? `已初始化：${folder.path}（${file.name}）`
              : `已初始化过，沿用：${file.path}`,
          );
        }),
      "anke init — 选择要初始化的文件夹（保留现有文件）",
    ).open();
  }
  newCharacter(project: Project): void {
    new Form(
      this.app,
      "添加角色",
      [{ key: "name", label: "角色名称" }],
      async (values) => {
        await this.library.createCharacter(project, values.name);
      },
      "保存",
      true,
    ).open();
  }
  migrateCharacter(project: Project, character: Character): void {
    const modal = new Modal(this.app);
    modal.setTitle(`合并「${character.name}」为单文件`);
    modal.contentEl.createEl("p", {
      text: `将 ${this.library.legacyFiles(character).length} 个差分清单合并到 ${this.library.characterFolder(project.root)}/${character.file.basename}.md。旧 Markdown 备份保存在 Vault 垃圾箱；原有图片留在原位，避免正文引用断开。`,
    });
    new Setting(modal.contentEl).addButton((button) =>
      button
        .setButtonText("合并")
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          run(async () => {
            try {
              const folded = this.library
                .legacyFiles(character)
                .filter((file) => this.data.collapsedGroups.includes(file.path))
                .map((file) =>
                  file.path
                    .slice(character.root.length + 7, -3)
                    .split("/")
                    .join(" / "),
                );
              const file = await this.library.migrateCharacter(
                project,
                character,
              );
              this.data.collapsedGroups = this.data.collapsedGroups.filter(
                (path) => !path.startsWith(character.root + "/"),
              );
              for (const group of await this.library.groups(character))
                if (
                  folded.some(
                    (name) =>
                      group.path === name ||
                      group.path.startsWith(name + " / "),
                  )
                )
                  this.data.collapsedGroups.push(group.key);
              await this.persist();
              modal.close();
              const leaf =
                this.app.workspace
                  .getLeavesOfType("markdown")
                  .find(
                    (leaf) => leaf.getViewState().state?.file === file.path,
                  ) ?? this.app.workspace.getLeaf("tab");
              await leaf.openFile(file);
              await this.app.workspace.revealLeaf(leaf);
              this.refresh();
              new Notice(
                "已合并为单文件。原 Markdown 可在 Vault 垃圾箱中找回。",
              );
            } finally {
              button.setDisabled(false);
            }
          });
        }),
    );
    modal.open();
  }
  async searchVariants(
    project: Project,
    editor: Editor,
    info: MarkdownFileInfo,
  ): Promise<void> {
    const target = info.file;
    if (!target) return;
    const owner =
      info instanceof MarkdownView
        ? info.containerEl.ownerDocument
        : activeDocument;
    const selected = this.views().find(
      (view) => view.containerEl.ownerDocument === owner,
    )?.characterPath;
    const visible = this.library.characters(project);
    const character =
      visible.find((c) => c.file.path === selected) ?? visible[0];
    const choices: VariantChoice[] = (
      await Promise.all(
        this.library
          .characters(project, false)
          .map(async (c) =>
            (await this.library.groups(c)).flatMap((group) =>
              group.entries.map((entry) => ({ character: c, group, entry })),
            ),
          ),
      )
    ).flat();
    new VariantSearch(
      this.app,
      choices,
      character?.file.path,
      new Set(this.data.collapsedGroups),
      (choice) => {
        try {
          if (info.file !== target || !this.library.chapterProject(target))
            throw new Error("正文已切换，请重新搜索差分。");
          const insert = this.library.imageLink(
            choice.entry.url,
            choice.group.file,
            target,
            choice.entry.label,
          );
          editor.replaceSelection(insert);
          this.recordVariantUse(choice.group.file, choice.entry.url);
          editor.focus();
        } catch (error) {
          report(error);
        }
      },
      (choice) =>
        this.library.resolveMedia(choice.entry.url, choice.group.file),
      (choice) =>
        this.data.variantUsage[choice.group.file.path]?.[choice.entry.url],
    ).open();
  }
  insertVariant(
    entry: Variant,
    source: TFile,
    project: Project,
    window: Window,
  ): void {
    try {
      const target = this.targets.get(window);
      if (
        !target?.file ||
        this.isWriting(target)?.file.path !== project.file.path ||
        !this.app.workspace
          .getLeavesOfType("markdown")
          .some((l) => l.view === target)
      )
        throw new Error("请先在这个窗口打开当前项目正文并放置光标。");
      const insert = this.library.imageLink(
        entry.url,
        source,
        target.file,
        entry.label,
      );
      target.editor.replaceSelection(insert);
      this.recordVariantUse(source, entry.url);
      target.editor.focus();
    } catch (error) {
      report(error);
    }
  }
  bindThread(project: Project): void {
    new Form(
      this.app,
      "绑定 NGA 主题",
      [{ key: "url", label: "主题链接", value: project.thread }],
      async (values) => {
        const url = threadUrl(values.url);
        await this.app.fileManager.processFrontMatter(project.file, (fm) => {
          fm["nga-thread"] = url;
        });
      },
    ).open();
  }
  currentWritingEditor(
    root: WorkspaceParent,
    project?: Project,
  ): { file: TFile; editor: Editor } {
    const view = this.app.workspace.getMostRecentLeaf(root)?.view;
    if (
      !(view instanceof MarkdownView) ||
      !view.file ||
      view.getMode() !== "source"
    )
      throw new Error(
        "请先在这个窗口编辑项目正文，并把光标放在要发布的分节内。",
      );
    const current = this.isWriting(view);
    if (!current || (project && current.file.path !== project.file.path))
      throw new Error("请先在这个窗口编辑当前项目正文，并放置光标。");
    return { file: view.file, editor: view.editor };
  }
  schedule(file: TFile, editor: Editor): void {
    const offset = editor.posToOffset(editor.getCursor());
    const original = editor.getValue(),
      originalSegment = segmentAt(original, offset),
      originalBody = original.slice(originalSegment.from, originalSegment.to);
    const local = new Date(Date.now() + 3600000);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    new Form(
      this.app,
      `设置自动发布 · ${file.basename} · ${originalSegment.title}`,
      [
        {
          key: "time",
          label: "本机时区的发布时间",
          type: "datetime-local",
          value: local.toISOString().slice(0, 16),
        },
      ],
      async (values) => {
        const time = new Date(values.time);
        if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now())
          throw new Error("请选择未来的时间。");
        await this.library.patch(file, (text) => {
          const section = segmentAt(text, offset);
          if (text.slice(section.from, section.to) !== originalBody)
            throw new Error("分节已改变，请关闭后重新安排。");
          return (
            text.slice(0, section.from) +
            wrapSegment(text, section, {
              time: time.toISOString(),
              task: crypto.randomUUID(),
            }) +
            text.slice(section.to)
          );
        });
        new Notice(
          this.data.executor === this.deviceId
            ? "已安排：到时读取标签内的最新正文。"
            : "已添加任务；请在设置里将本机设为定时发布执行设备。",
          7000,
        );
      },
      "设置自动发布",
    ).open();
  }
  showPublishing(project: Project): void {
    run(async () => {
      const modal = new Modal(this.app);
      modal.setTitle(`${project.name} · 发布记录`);
      const connection = new Setting(modal.contentEl)
        .setName("检查发布连接")
        .setDesc(
          "使用插件已保存的 Cookie 检查此帖的回复准备接口，不发送正文、不改变发布进度。",
        );
      connection.addButton((button) => {
        button.setButtonText("检查").onClick(() =>
          run(async () => {
            button.setDisabled(true);
            connection.setDesc("正在检查 NGA 回复接口……");
            try {
              const cookie =
                this.app.secretStorage.getSecret("anke-nga-cookie");
              if (!cookie) throw new Error("请先在插件设置中保存 NGA Cookie。");
              await prepareReply(project.thread, cookie);
              connection.setDesc(
                "已取得此帖的回复准备信息。没有发送正文，也没有改变发布进度。",
              );
            } catch (error) {
              connection.setDesc(
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              button.setDisabled(false);
            }
          }),
        );
      });
      for (const [path, error] of this.publishErrors)
        if (path.startsWith(project.root + "/"))
          modal.contentEl.createEl("p", { text: `${path}：${error}` });
      const pending = (await this.publisher.pending()).filter(
        (p) => p.project.file.path === project.file.path,
      );
      const journal = this.data.journal;
      const ids = new Set([
        ...pending.map((p) => p.tag.attrs.task),
        ...Object.keys(journal).filter((id) =>
          journal[id].file.startsWith(project.root + "/"),
        ),
      ]);
      for (const id of ids) {
        const item = pending.find((p) => p.tag.attrs.task === id),
          entry = journal[id];
        const status =
          entry?.status ||
          (item?.tag.attrs.sent || item?.tag.attrs.marked ? "sent" : "pending");
        const labels: Record<string, string> = {
          pending: "待发布",
          sending: "发送中",
          sent: "已发送",
          unknown: "结果待核对",
          failed: "失败",
          missed: "错过时间",
          blocked: "需要修正",
        };
        const row = new Setting(modal.contentEl)
          .setName(
            `${labels[status]} · ${item?.file.basename || entry?.file || "无效任务"}`,
          )
          .setDesc(entry?.message || item?.tag.attrs.time || "手动发布记录");
        if (entry?.content)
          row.addButton((b) =>
            b.setButtonText("查看发送正文").onClick(() => {
              const detail = new Modal(this.app);
              detail.setTitle("实际发送的 BBCode");
              detail.contentEl.createEl("pre", {
                text: entry.content,
                cls: "anke-publish-preview",
              });
              detail.open();
            }),
          );
        if (item)
          row.addButton((b) =>
            b.setButtonText("定位").onClick(() =>
              run(async () => {
                modal.close();
                const leaf = this.app.workspace.getLeaf("tab");
                await leaf.openFile(item.file);
                if (leaf.view instanceof MarkdownView)
                  leaf.view.editor.setCursor(
                    leaf.view.editor.offsetToPos(item.tag.from),
                  );
              }),
            ),
          );
        if (item && !["sending", "sent"].includes(status))
          row.addButton((b) =>
            b.setButtonText("取消发布").onClick(() =>
              run(async () => {
                if (this.publisher.busy)
                  throw new Error("正在执行发布任务，请稍后再取消。");
                if (["sending", "sent"].includes(journal[id]?.status))
                  throw new Error("该任务已开始发送，不能取消。");
                this.publisher.busy = true;
                b.setDisabled(true);
                try {
                  await this.library.patch(item.file, (text) => {
                    const tags = timingTags(text).filter(
                      (t) => t.attrs.task === id,
                    );
                    if (tags.length !== 1)
                      throw new Error(
                        "标签丢失或重复，请重新打开发布记录检查。",
                      );
                    const t = tags[0];
                    return (
                      text.slice(0, t.from) +
                      text.slice(t.openEnd, t.closeStart) +
                      text.slice(t.to)
                    );
                  });
                  modal.close();
                  new Notice(
                    journal[id]?.status === "unknown"
                      ? "已移除发布安排，正文和历史记录保留；上次发送结果仍需到 NGA 核对。"
                      : "已取消发布，正文和历史记录保留。",
                  );
                } finally {
                  this.publisher.busy = false;
                  b.setDisabled(false);
                }
              }),
            ),
          );
      }
      if (!ids.size)
        modal.contentEl.createEl("p", {
          text: "还没有发布记录。把光标放在正文分节内，点击「发布当前分节」或「设置自动发布」。",
        });
      modal.open();
    });
  }
  importImages(character: Character): void {
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
    new Pick(
      this.app,
      folders,
      (f) => f.path,
      (folder) =>
        run(async () => {
          const images = this.app.vault
            .getFiles()
            .filter(
              (f) =>
                f.path.startsWith(folder.path + "/") &&
                /^(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(f.extension),
            );
          if (!images.length) throw new Error("目录里没有支持的图片。");
          const groups = new Map<string, TFile[]>();
          for (const file of images) {
            const relative = file
              .parent!.path.slice(folder.path.length)
              .replace(/^\//, "");
            const name = [folder.name, relative].filter(Boolean).join(" / ");
            groups.set(name, [...(groups.get(name) || []), file]);
          }
          const added = [...groups]
            .map(
              ([name, files]) =>
                `# ${name}\n\n${files.map((file) => "- " + this.library.imageLink(file.path, file, character.file, file.basename, false)).join("\n")}`,
            )
            .join("\n\n");
          await this.library.patch(
            character.file,
            (text) => text + "\n\n" + added + "\n",
          );
          this.refresh();
        }),
      "选择 Vault 中的图片目录（含子目录）",
    ).open();
  }
}
class AnkeSettings extends PluginSettingTab {
  constructor(readonly plugin: AnkePlugin) {
    super(plugin.app, plugin);
  }
  display(): void {
    this.containerEl.empty();
    const characterFolder = new Setting(this.containerEl)
      .setName("Character folder name")
      .setDesc(
        "每个作品内的角色文件夹名称，默认「角色」，例如 Characters。对当前 Vault 的所有作品生效；只填单层名称，不含路径。点击保存生效。已有文件夹需在 Obsidian 中改成对应名称，此设置不会移动文件。",
      );
    let folderName = this.plugin.data.characterFolderName;
    characterFolder.addText((input) =>
      input
        .setValue(folderName)
        .setPlaceholder(defaults.characterFolderName)
        .onChange((text) => {
          folderName = text;
        }),
    );
    characterFolder.addButton((button) =>
      button.setButtonText("保存").onClick(() =>
        run(async () => {
          await this.plugin.setCharacterFolderName(folderName);
          new Notice("角色文件夹名称已保存。");
        }),
      ),
    );
    const pattern = new Setting(this.containerEl)
      .setName("正文文件名正则")
      .setDesc(
        "匹配不含 .md 的文件名，使用 JavaScript 正则，不加两侧 /。默认 ^\\d+-\\d+ 匹配 1-1、2-3 等开头；点击保存生效。项目配置和角色目录始终排除。",
      );
    let value = this.plugin.data.chapterPattern;
    pattern.addText((input) =>
      input
        .setValue(value)
        .setPlaceholder(defaults.chapterPattern)
        .onChange((text) => {
          value = text;
        }),
    );
    pattern.addButton((button) =>
      button.setButtonText("保存").onClick(() =>
        run(async () => {
          await this.plugin.setChapterPattern(value);
          new Notice("正文识别规则已保存。");
        }),
      ),
    );
    new Setting(this.containerEl)
      .setName("NGA Cookie")
      .setDesc("保存在 Obsidian 凭据存储中；不会写入项目 Markdown 或插件配置。")
      .addText((input) => {
        input.inputEl.type = "password";
        input.setPlaceholder(
          this.app.secretStorage.getSecret("anke-nga-cookie")
            ? "已保存；输入新值替换"
            : "粘贴 Cookie",
        );
        input.inputEl.onchange = () => {
          this.app.secretStorage.setSecret("anke-nga-cookie", input.getValue());
          input.setValue("");
          new Notice("凭据已更新。");
        };
      });
    new Setting(this.containerEl)
      .setName("本机执行定时发布")
      .setDesc(
        "一个同步 Vault 只指定一台执行设备。关闭或休眠期间错过的任务需要手动处理。",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.executor === this.plugin.deviceId)
          .onChange(async (value) => {
            this.plugin.data.executor = value ? this.plugin.deviceId : "";
            this.plugin.publisher.previousTick = Date.now();
            await this.plugin.persist();
          }),
      );
    this.containerEl.createEl("p", {
      text: `快捷键：Option/Alt+D 插入 NGA 骰子；Option/Alt+1～3 按可见角色顺序上色并选中角色；Option/Alt+C 复制为 NGA BBCode；Cmd/Ctrl+Shift+P 搜索差分并插入。在 Obsidian「快捷键」中搜索「${this.plugin.manifest.name}」可修改全部命令。`,
    });
    this.containerEl.createEl("p", {
      text: "新分节：独立一行 ---。命名分节：输入 ---重逢 后按回车。Tab 确认补全 [quote]、[collapse] 和 [color]。",
    });
  }
}
