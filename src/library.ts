import { absoluteNGAImageUrl } from "./nga-images";
import {
  App,
  getFrontMatterInfo,
  MarkdownView,
  normalizePath,
  parseYaml,
  parseLinktext,
  TFile,
  TFolder,
} from "obsidian";
import { posix } from "node:path";
import {
  appendVariantLine,
  deleteVariant,
  end,
  parse,
  start,
  markdownLink,
  mapLinkDestinations,
  variantSections,
  variants,
  type Variant,
  type VariantSection,
} from "./document";

const imagePath = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#]|$)/i;

export interface Project {
  file: TFile;
  root: string;
  name: string;
  characters: string[];
  thread: string;
}
export interface Character {
  file: TFile;
  root: string;
  name: string;
  color: string;
  avatar: string;
}
export interface VariantGroup extends VariantSection {
  file: TFile;
  sectionKey: string;
}
export class Library {
  constructor(
    readonly app: App,
    public chapterPattern: RegExp,
    public characterFolderName: string,
  ) {}
  projects(): Project[] {
    return this.app.vault
      .getMarkdownFiles()
      .flatMap((file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return fm?.["anke-type"] === "project"
          ? [
              {
                file,
                root: file.parent!.path,
                name: String(fm.name || file.basename),
                characters: Array.isArray(fm.characters)
                  ? fm.characters.filter((v: unknown) => typeof v === "string")
                  : [],
                thread: String(fm["nga-thread"] || ""),
              },
            ]
          : [];
      })
      .sort((a, b) =>
        a.file.path.localeCompare(b.file.path, "zh-CN", { numeric: true }),
      );
  }
  projectFor(file: TFile | null): Project | undefined {
    return file
      ? this.projects()
          .filter((p) => file.path.startsWith(p.root + "/"))
          .sort((a, b) => b.root.length - a.root.length)[0]
      : undefined;
  }
  characterFolder(projectRoot: string): string {
    return `${projectRoot}/${this.characterFolderName}`;
  }
  characters(project: Project, visibleOnly = true): Character[] {
    const all = this.app.vault.getMarkdownFiles().flatMap((file) => {
      if (!file.path.startsWith(this.characterFolder(project.root) + "/"))
        return [];
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return fm?.["anke-type"] === "character"
        ? [
            {
              file,
              root: file.parent!.path,
              name: String(fm.name || file.basename),
              color: String(fm.color || "red"),
              avatar: String(fm.avatar || ""),
            },
          ]
        : [];
    });
    if (!visibleOnly) return all;
    return project.characters
      .flatMap((link) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(
          link.replace(/^\[\[|\]\]$/g, "").split("|")[0],
          project.file.path,
        );
        const character = all.find((c) => c.file.path === file?.path);
        return character ? [character] : [];
      })
      .filter(
        (c, i, a) => a.findIndex((v) => v.file.path === c.file.path) === i,
      );
  }
  chapterProject(file: TFile | null): Project | undefined {
    if (!file || !this.chapterPattern.test(file.basename)) return undefined;
    const project = this.projectFor(file);
    // Project configuration and character resources never become chapter content.
    if (
      !project ||
      file === project.file ||
      file.path.startsWith(this.characterFolder(project.root) + "/")
    )
      return undefined;
    return project;
  }
  chapters(project: Project): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.chapterProject(f)?.file.path === project.file.path)
      .sort(
        (a, b) =>
          a.basename.localeCompare(b.basename, "zh-CN", { numeric: true }) ||
          a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
      );
  }
  legacyFiles(character: Character): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          file.path.startsWith(character.file.parent!.path + "/photo/") &&
          this.app.metadataCache.getFileCache(file)?.frontmatter?.[
            "anke-type"
          ] === "variants",
      );
  }
  isLegacy(character: Character): boolean {
    const project = this.projectFor(character.file);
    return (
      !!project &&
      character.file.parent!.path !== this.characterFolder(project.root) &&
      !!this.app.vault.getFolderByPath(character.file.parent!.path + "/photo")
    );
  }
  async groups(character: Character): Promise<VariantGroup[]> {
    if (this.isLegacy(character)) return [];
    return variantSections(await this.read(character.file)).map((section) => ({
      ...section,
      file: character.file,
      sectionKey: section.key,
      entries: section.entries.filter((entry) =>
        this.isImage(entry, character.file),
      ),
      parentKey: section.parentKey
        ? `${character.file.path}#${section.parentKey}`
        : undefined,
      key: `${character.file.path}#${section.key}`,
    }));
  }
  imageEntries(text: string, source: TFile): Variant[] {
    return variants(text).filter((entry) => this.isImage(entry, source));
  }
  private isImage(entry: Variant, source: TFile): boolean {
    if (/^https?:\/\//i.test(entry.url))
      return !!entry.image || imagePath.test(entry.url);
    try {
      return imagePath.test(this.mediaFile(entry.url, source).path);
    } catch {
      return imagePath.test(entry.url);
    }
  }
  editor(file: TFile): MarkdownView | undefined {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .map((l) => l.view)
      .find(
        (v) =>
          v instanceof MarkdownView &&
          v.file?.path === file.path &&
          v.getMode() === "source",
      ) as MarkdownView | undefined;
  }
  read(file: TFile): Promise<string> {
    return this.editor(file)
      ? Promise.resolve(this.editor(file)!.editor.getValue())
      : this.app.vault.read(file);
  }
  async patch(file: TFile, transform: (text: string) => string): Promise<void> {
    const view = this.editor(file);
    if (!view) {
      await this.app.vault.process(file, transform);
      return;
    }
    const editor = view.editor,
      previous = editor.getValue(),
      next = transform(previous);
    if (previous === next) return;
    let from = 0,
      oldEnd = previous.length,
      newEnd = next.length;
    while (from < oldEnd && from < newEnd && previous[from] === next[from])
      from++;
    while (
      oldEnd > from &&
      newEnd > from &&
      previous[oldEnd - 1] === next[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }
    editor.transaction({
      changes: [
        {
          from: editor.offsetToPos(from),
          to: editor.offsetToPos(oldEnd),
          text: next.slice(from, newEnd),
        },
      ],
    });
  }
  async moveVariant(
    source: TFile,
    entry: Variant,
    target: VariantGroup,
  ): Promise<string> {
    const checkTarget = (text: string) => {
      const section = variantSections(text).find(
        (part) => part.key === target.sectionKey,
      );
      if (!section || section.headingFrom !== target.headingFrom)
        throw new Error("目标差分组已改变，请刷新后再移动。");
      return section;
    };
    if (source.path === target.file.path) {
      await this.patch(source, (text) => {
        const section = checkTarget(text);
        const removed = deleteVariant(text, entry);
        if (section.entries.some((row) => row.from === entry.from)) return text;
        return appendVariantLine(removed, target.sectionKey, entry.raw);
      });
      return entry.url;
    }
    // Validate before writing, then check again when deleting from the live source.
    deleteVariant(await this.read(source), entry);
    const raw = this.rebaseLinks(entry.raw, source, target.file.path);
    let movedUrl = entry.url;
    await this.patch(target.file, (text) => {
      checkTarget(text);
      const next = appendVariantLine(text, target.sectionKey, raw);
      movedUrl = variantSections(next)
        .find((section) => section.key === target.sectionKey)!.entries.at(-1)!.url;
      return next;
    });
    try {
      await this.patch(source, (text) => deleteVariant(text, entry));
    } catch (error) {
      // Keep the destination copy: rolling it back could lose an intervening edit.
      throw new Error(
        `差分已写入 ${target.file.path}，但来源未能移除；请检查两份文件。${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return movedUrl;
  }
  mediaFile(url: string, source: TFile): TFile {
    url = url.replace(/^!?\[\[|\]\]$/g, "").split("|")[0];
    if (/^[a-z][a-z\d+.-]*:/i.test(url))
      throw new Error("只支持 HTTP(S) 图片或 Vault 内图片。");
    const decoded = decodeURI(url);
    const path = normalizePath(
      posix.normalize(posix.join(source.parent!.path, decoded)),
    );
    const file =
      this.app.vault.getAbstractFileByPath(path) ??
      this.app.metadataCache.getFirstLinkpathDest(decoded, source.path);
    if (!(file instanceof TFile)) throw new Error(`找不到图片：${url}`);
    return file;
  }
  resolveMedia(url: string, source: TFile): string {
    url = absoluteNGAImageUrl(url);
    return /^https?:\/\//i.test(url)
      ? url
      : this.app.vault.getResourcePath(this.mediaFile(url, source));
  }
  insertionUrl(url: string, source: TFile, target: TFile): string {
    url = absoluteNGAImageUrl(url);
    return /^https?:\/\//i.test(url)
      ? url
      : posix.relative(target.parent!.path, this.mediaFile(url, source).path);
  }
  imageLink(
    url: string,
    source: TFile,
    target: TFile,
    label: string,
    image = true,
  ): string {
    url = absoluteNGAImageUrl(url);
    if (/^https?:\/\//i.test(url))
      return markdownLink(label, url, image || !imagePath.test(url));
    const file = this.mediaFile(url, source);
    let link = this.app.fileManager.generateMarkdownLink(
      file,
      target.path,
      undefined,
      label,
    );
    if (!label)
      link = link.startsWith("[[")
        ? link.replace(/(?:\|[^\]]*)?\]\]$/, "|]]")
        : link.replace(/^\[[^\]]*\]/, "[]");
    return (image ? "!" : "") + link;
  }
  async folders(path: string): Promise<void> {
    let part = "";
    for (const name of normalizePath(path).split("/")) {
      part = part ? part + "/" + name : name;
      if (!this.app.vault.getAbstractFileByPath(part))
        await this.app.vault.createFolder(part);
    }
  }
  async initProject(
    folder: TFolder,
  ): Promise<{ file: TFile; created: boolean }> {
    if (folder.isRoot()) throw new Error("请选择 Vault 内的作品文件夹。");
    if (this.app.vault.getFolderByPath(folder.path) !== folder)
      throw new Error("文件夹已移动或删除，请重新选择。");
    validName(folder.name);
    // Read current contents: metadata indexing can lag behind an immediate re-run.
    const configs: TFile[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const info = getFrontMatterInfo(await this.read(child));
      if (
        info.exists &&
        parseYaml(info.frontmatter)?.["anke-type"] === "project"
      )
        configs.push(child);
    }
    if (configs.length > 1)
      throw new Error("该文件夹有多个项目配置，请先保留一个有效的项目配置。");
    const characterPath = this.characterFolder(folder.path),
      characterFolder = this.app.vault.getAbstractFileByPath(characterPath);
    if (characterFolder && !(characterFolder instanceof TFolder))
      throw new Error(
        `角色目录位置已被文件占用：${characterPath}。请修改 Character folder name 或自行调整该文件。`,
      );
    let path = `${folder.path}/${folder.name}.md`;
    for (
      let index = 1;
      path === characterPath || this.app.vault.getAbstractFileByPath(path);
      index++
    )
      path = `${folder.path}/${folder.name} ${index}.md`;
    if (!characterFolder) await this.app.vault.createFolder(characterPath);
    if (configs[0]) return { file: configs[0], created: false };
    const name = folder.name;
    const file = await this.app.vault.create(
      path,
      `---\nanke-type: project\nname: ${JSON.stringify(name)}\ncharacters: []\nnga-thread: ""\n---\n\n# ${name}\n\n在 characters 属性中配置可见角色及顺序，也可以使用角色侧边栏。\n`,
    );
    return { file, created: true };
  }
  async createProject(name: string): Promise<TFile> {
    validName(name);
    if (this.app.vault.getAbstractFileByPath(name))
      throw new Error("同名项目已经存在。");
    const folder = await this.app.vault.createFolder(name);
    const { file } = await this.initProject(folder);
    await this.app.vault.create(`${name}/1-1 第一章.md`, "# 第一章\n\n");
    return file;
  }
  async createCharacter(project: Project, name: string): Promise<TFile> {
    validName(name);
    const path = `${this.characterFolder(project.root)}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path))
      throw new Error("项目内已存在同名角色。");
    await this.folders(this.characterFolder(project.root));
    const file = await this.app.vault.create(
      path,
      `---\nanke-type: character\nname: ${JSON.stringify(name)}\naliases: []\ncolor: "red"\navatar: ""\nnotes: ""\n---\n\n# 默认\n\n`,
    );
    await this.app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters = [
        ...(fm.characters || []),
        `[[${file.path.slice(0, -3)}]]`,
      ];
    });
    return file;
  }
  async deleteCharacter(project: Project, character: Character): Promise<void> {
    if (
      !character.file.path.startsWith(this.characterFolder(project.root) + "/")
    )
      throw new Error("找不到当前项目的角色文件。");
    const links = project.characters.filter(
      (link) =>
        this.app.metadataCache.getFirstLinkpathDest(
          link.replace(/^\[\[|\]\]$/g, "").split("|")[0],
          project.file.path,
        )?.path === character.file.path,
    );
    await this.app.vault.trash(character.file, false);
    await this.app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters = (fm.characters || []).filter(
        (link: string) => !links.includes(link),
      );
    });
  }
  async setVisible(project: Project, paths: string[]): Promise<void> {
    await this.app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters = paths.map((p) => `[[${p.replace(/\.md$/, "")}]]`);
    });
  }
  rebaseLinks(text: string, source: TFile, targetPath: string): string {
    return mapLinkDestinations(text, (url, wiki) => {
      if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("#") ||
        absoluteNGAImageUrl(url) !== url) return url;
      const { path, subpath } = parseLinktext(decodeURI(url));
      const file = this.mediaFile(path, source);
      return (
        (wiki
          ? file.path
          : encodeURI(
              posix.relative(posix.dirname(targetPath), file.path),
            ).replace(/#/g, "%23")) + subpath
      );
    });
  }
  async copyCharacter(
    source: Character,
    project: Project,
    name: string,
  ): Promise<void> {
    if (this.isLegacy(source)) throw new Error("请先将来源角色合并为单文件。");
    validName(name);
    const path = `${this.characterFolder(project.root)}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path))
      throw new Error("目标项目内已存在同名角色。");
    const text = this.rebaseLinks(
      await this.read(source.file),
      source.file,
      path,
    );
    const avatar =
      source.avatar && !/^https?:\/\//i.test(absoluteNGAImageUrl(source.avatar))
        ? posix.relative(
            posix.dirname(path),
            this.mediaFile(source.avatar, source.file).path,
          )
        : source.avatar;
    await this.folders(this.characterFolder(project.root));
    const note = await this.app.vault.create(path, text);
    await this.app.fileManager.processFrontMatter(note, (fm) => {
      fm.name = name;
      fm.avatar = avatar;
    });
    await this.app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters = [
        ...(fm.characters || []),
        `[[${note.path.slice(0, -3)}]]`,
      ];
    });
  }
  async migrateCharacter(
    project: Project,
    character: Character,
  ): Promise<TFile> {
    if (!this.isLegacy(character))
      throw new Error("这个角色已经是单文件格式。");
    const target = `${this.characterFolder(project.root)}/${character.file.basename}.md`;
    if (this.app.vault.getAbstractFileByPath(target))
      throw new Error(`目标文件已存在：${target}`);
    const catalogs = this.legacyFiles(character).sort((a, b) =>
      a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
    );
    const oldPath = character.file.path;
    const visibleLinks = project.characters.filter(
      (link) =>
        this.app.metadataCache.getFirstLinkpathDest(
          link.replace(/^\[\[|\]\]$/g, "").split("|")[0],
          project.file.path,
        )?.path === oldPath,
    );
    const oldRoot = character.file.parent!.path;
    const original = await this.read(character.file);
    const rebased = this.rebaseLinks(original, character.file, target);
    const avatar =
      character.avatar && !/^https?:\/\//i.test(absoluteNGAImageUrl(character.avatar))
        ? posix.relative(
            posix.dirname(target),
            this.mediaFile(character.avatar, character.file).path,
          )
        : character.avatar;
    const sections: string[] = [];
    const originals = new Map<TFile, string>();
    for (const file of catalogs) {
      let text = await this.read(file);
      originals.set(file, text);
      text = this.rebaseLinks(text, file, target);
      const info = getFrontMatterInfo(text);
      const body = text.slice(info.exists ? info.contentStart : 0);
      const title = file.path
        .slice(oldRoot.length + 7, -3)
        .split("/")
        .join(" / ");
      // A catalog becomes a top-level group; existing headings remain nested underneath it.
      let nested = body;
      for (const heading of parse(body)
        .children.filter((node) => node.type === "heading")
        .reverse()) {
        const raw = body.slice(start(heading), end(heading));
        const replacement = /^#{1,5} /.test(raw)
          ? "#" + raw
          : /^#{6} /.test(raw)
            ? raw
            : "## " + raw.split("\n")[0];
        nested =
          nested.slice(0, start(heading)) +
          replacement +
          nested.slice(end(heading));
      }
      sections.push(`# ${title}\n\n${nested}`);
    }
    const backup = `.trash/obs-anker-migration-${Date.now()}`;
    if (!(await this.app.vault.adapter.exists(".trash")))
      await this.app.vault.adapter.mkdir(".trash");
    await this.app.vault.adapter.mkdir(backup);
    await this.app.vault.adapter.write(
      `${backup}/${character.file.name}`,
      original,
    );
    await this.app.fileManager.renameFile(character.file, target);
    const moved = await this.read(character.file);
    await this.patch(character.file, (latest) => {
      if (latest !== moved)
        throw new Error("角色资料刚被修改，请重新检查后合并。");
      const info = getFrontMatterInfo(rebased);
      const note = rebased.slice(info.contentStart).trim();
      const details = note
        ? "> [!info] 角色资料（旧版）\n" +
          note
            .split("\n")
            .map((line) => "> " + line)
            .join("\n") +
          "\n\n"
        : "";
      return (
        rebased.slice(0, info.contentStart) +
        "\n" +
        details +
        sections.join("\n\n")
      );
    });
    await this.app.fileManager.processFrontMatter(character.file, (fm) => {
      fm.avatar = avatar;
    });
    await this.app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters = (fm.characters || []).map((link: string) =>
        visibleLinks.includes(link) ? `[[${target.slice(0, -3)}]]` : link,
      );
    });
    for (const file of catalogs) {
      if ((await this.read(file)) !== originals.get(file))
        throw new Error(
          `已合并，但清单刚被修改，保留原文件供核对：${file.path}`,
        );
      await this.app.vault.trash(file, false);
    }
    // Local attachments stay in place so existing chapter references remain valid.
    const folders = this.app.vault
      .getAllFolders()
      .filter(
        (folder) =>
          folder.path === oldRoot || folder.path.startsWith(oldRoot + "/"),
      )
      .sort((a, b) => b.path.length - a.path.length);
    for (const folder of folders)
      if (!folder.children.length) await this.app.vault.trash(folder, false);
    return character.file;
  }
}
export function validName(name: string): void {
  if (
    !name.trim() ||
    name !== name.trim() ||
    /[\\/:*?"<>|\r\n]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
  )
    throw new Error("名称不能为空，且不能包含 Windows 文件名禁用字符。");
}
