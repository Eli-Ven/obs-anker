import { NGA_IMAGE_SIZES, ngaImageSizeUrl, absoluteNGAImageUrl } from "./nga-images";
import { verifyNGAImage } from "./nga";
import {
  FileView,
  MarkdownView,
  ItemView,
  Menu,
  Modal,
  Notice,
  Scope,
  Setting,
  setTooltip,
  TFile,
  WorkspaceLeaf,
  type ViewStateResult,
} from "obsidian";
import type AnkePlugin from "./main";
import type { Character, Project, VariantGroup } from "./library";
import {
  appendVariant,
  editVariant,
  resizeVariant,
  editAndPromoteVariant,
  deleteVariant,
  markdownLink,
  reorderVariant,
  reorderVariantSection,
  variantSections,
  type Variant,
} from "./document";
import { Form, Pick, run } from "./ui";
import { NGA_COLORS } from "./nga-colors";
import {
  rankVariants,
  resetBoost,
  type CharacterUsage,
} from "./variant-ranking";

type DraggedVariant = Variant & { file: string; group: string };

export const VIEW_TYPE = "anke-characters";
export class CharacterView extends ItemView {
  characterPath = "";
  private generation = 0;
  private preview?: HTMLElement;
  private tabGroup: HTMLElement | null = null;
  private outlineFile: TFile | null = null;
  private rankingFile: TFile | null = null;
  private usageSnapshot: CharacterUsage = {};
  private rankedAt = 0;
  private outlineFolds = new Map<string, boolean>();
  constructor(
    leaf: WorkspaceLeaf,
    readonly plugin: AnkePlugin,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "W", () => false);
  }
  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.plugin.manifest.name;
  }
  getIcon(): string {
    return "users";
  }
  getState(): Record<string, unknown> {
    return { characterPath: this.characterPath };
  }
  async setState(
    state: { characterPath?: string },
    result: ViewStateResult,
  ): Promise<void> {
    this.characterPath = state.characterPath || "";
    await super.setState(state, result);
    await this.render();
  }
  async onOpen(): Promise<void> {
    this.rankingFile = null;
    const followFile = () => this.followOutlineFile();
    this.registerEvent(this.app.workspace.on("file-open", followFile));
    this.registerEvent(this.app.workspace.on("active-leaf-change", followFile));
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateTabStrip()),
    );
    this.updateTabStrip();
    await this.render();
  }
  private followOutlineFile(): void {
    const view = this.app.workspace.getMostRecentLeaf(
      this.leaf.getContainer(),
    )?.view;
    const file = view instanceof FileView ? view.file : null;
    if (file !== this.outlineFile) {
      this.outlineFile = file;
      this.outlineFolds.clear();
    }
  }
  async onClose(): Promise<void> {
    this.hidePreview();
    this.tabGroup?.removeClass("anke-single-panel");
    this.tabGroup = null;
  }
  private updateTabStrip(): void {
    const group = this.containerEl.closest<HTMLElement>(".workspace-tabs");
    if (this.tabGroup !== group) {
      this.tabGroup?.removeClass("anke-single-panel");
      this.tabGroup = group;
    }
    if (!group) return;
    const leaves = group.querySelectorAll(
      ":scope > .workspace-tab-container > .workspace-leaf",
    );
    group.toggleClass(
      "anke-single-panel",
      leaves.length === 1 && leaves[0].contains(this.containerEl),
    );
  }
  resetUsageBoost(file: TFile, urls: string[]): void {
    if (file === this.rankingFile) resetBoost(this.usageSnapshot, urls);
  }
  select(character: Character): void {
    this.rankingFile = null;
    this.characterPath = character.file.path;
    run(() => this.render());
    this.app.workspace.requestSaveLayout();
  }
  async render(): Promise<void> {
    const doc = this.contentEl.ownerDocument;
    if (
      this.contentEl.contains(doc.activeElement) &&
      ["INPUT", "TEXTAREA"].includes(doc.activeElement?.tagName || "")
    )
      return;
    this.followOutlineFile();
    const generation = ++this.generation;
    const library = this.plugin.library;
    const focused = this.app.workspace.getMostRecentLeaf(
      this.leaf.getContainer(),
    )?.view;
    const project =
      focused instanceof FileView
        ? library.projectFor(focused.file)
        : undefined;
    const characters = project ? library.characters(project) : [];
    const focusedCharacter =
      project && focused instanceof FileView
        ? library
            .characters(project, false)
            .find((c) => c.file === focused.file)
        : undefined;
    const character =
      focusedCharacter ??
      characters.find((c) => c.file.path === this.characterPath) ??
      characters[0];
    const groups = character ? await library.groups(character) : [];
    if (generation !== this.generation) return;
    if (!character || focusedCharacter) this.rankingFile = null;
    else if (this.rankingFile !== character.file) {
      this.rankingFile = character.file;
      this.usageSnapshot = {
        ...this.plugin.data.variantUsage[character.file.path],
      };
      this.rankedAt = Date.now();
    }
    const oldBrowser = this.contentEl.querySelector<HTMLElement>(
      ".anke-variant-browser",
    );
    const horizontalScroll =
      oldBrowser && oldBrowser.dataset.character === character?.file.path
        ? oldBrowser.querySelector(".anke-variant-columns")?.scrollLeft || 0
        : 0;
    const outlineScroll =
      oldBrowser?.dataset.character === character?.file.path
        ? oldBrowser?.querySelector(".anke-outline")?.scrollTop || 0
        : 0;
    const verticalScroll = new Map(
      Array.from(
        this.contentEl.querySelectorAll<HTMLElement>(".anke-variant-group"),
        (column) => [
          column.dataset.path!,
          column.querySelector(".anke-variant-grid")?.scrollTop || 0,
        ],
      ),
    );
    this.hidePreview();
    this.contentEl.empty();
    this.contentEl.addClass("anke-panel");
    if (!project) {
      this.contentEl.createEl("p", {
        text: `当前文件不属于写作项目。请打开项目文件，或通过命令面板「${this.plugin.manifest.name}：创建写作项目」开始。`,
      });
      return;
    }
    this.characterPath = character?.file.path || "";
    const actions = this.contentEl.createDiv({ cls: "anke-toolbar" });
    this.button(actions, "+ 角色", () => this.plugin.newCharacter(project));
    this.button(actions, "可见角色", () => this.visibility(project));
    this.button(actions, this.plugin.data.compact ? "列表" : "网格", () => {
      this.plugin.data.compact = !this.plugin.data.compact;
      run(async () => {
        await this.plugin.persist();
        this.plugin.refresh();
      });
    });
    if (!character) {
      const empty = this.contentEl.createDiv({ cls: "anke-details" });
      empty.createEl("p", {
        text: "当前项目还没有可见角色。点击下方按钮创建，或在「可见角色」中选择已有角色。",
      });
      this.button(empty, "添加角色", () =>
        this.plugin.newCharacter(project),
      ).addClass("mod-cta");
      this.publishingActions(project);
      return;
    }
    const list = this.contentEl.createDiv({
      cls: `anke-character-list ${this.plugin.data.compact ? "is-grid" : ""}`,
    });
    list.style.height = `${this.plugin.data.characterHeight}px`;
    for (const c of characters) {
      const card = list.createEl("button", {
        cls: `anke-character ${c.file.path === character?.file.path ? "is-selected" : ""}`,
        attr: {
          draggable: "true",
          title: c.name,
          "aria-pressed": String(c.file.path === character?.file.path),
        },
      });
      if (c.avatar) this.thumbnail(card, c.avatar, c.file, c.name);
      else card.createSpan({ cls: "anke-initial", text: c.name.slice(0, 1) });
      card.createSpan({ text: c.name });
      card.onclick = () =>
        focusedCharacter ? run(() => this.openFile(c.file)) : this.select(c);
      card.oncontextmenu = (event) => {
        event.preventDefault();
        Menu.forEvent(event)
          .setUseNativeMenu(false)
          .addItem((item) =>
            item
              .setTitle("删除角色…")
              .setIcon("trash")
              .onClick(() => this.deleteCharacter(project, c)),
          )
          .showAtMouseEvent(event);
      };
      this.acceptVariantDrop(card, async (data) => {
        const groups = await library.groups(c);
        const first = groups.find((group) => group.entries.length) ?? groups[0];
        if (!first) throw new Error("请先将目标角色合并为单文件。");
        await this.moveDroppedVariant(data, first);
        new Notice(`已移入 ${c.name} / ${first.path}`);
      });
      card.ondragstart = (event) => {
        event.dataTransfer?.setData(
          "application/x-anke-character",
          c.file.path,
        );
      };
      card.ondragover = (event) => {
        if (event.dataTransfer?.types.includes("application/x-anke-character"))
          event.preventDefault();
      };
      card.ondrop = (event) => {
        const source = event.dataTransfer?.getData(
          "application/x-anke-character",
        );
        if (!source || source === c.file.path) return;
        event.preventDefault();
        const paths = characters.map((item) => item.file.path),
          from = paths.indexOf(source),
          to = paths.indexOf(c.file.path);
        if (from < 0) return;
        paths.splice(to, 0, paths.splice(from, 1)[0]);
        run(async () => {
          await library.setVisible(project, paths);
        });
      };
    }
    const minimumHeight = parseFloat(
      doc.defaultView!.getComputedStyle(list).minHeight,
    );
    const divider = this.contentEl.createDiv({
      cls: "anke-divider",
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-label": "调整角色列表高度",
        "aria-orientation": "horizontal",
      },
    });
    divider.onpointerdown = (event) => {
      divider.setPointerCapture(event.pointerId);
      const y = event.clientY,
        height = list.getBoundingClientRect().height;
      divider.onpointermove = (move) => {
        this.plugin.data.characterHeight = Math.max(
          minimumHeight,
          Math.min(
            this.contentEl.clientHeight - 120,
            height + move.clientY - y,
          ),
        );
        list.style.height = `${this.plugin.data.characterHeight}px`;
      };
      divider.onpointerup = divider.onpointercancel = () => {
        divider.onpointermove = null;
        run(() => this.plugin.persist());
      };
    };
    divider.onkeydown = (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      this.plugin.data.characterHeight = Math.max(
        minimumHeight,
        this.plugin.data.characterHeight + (event.key === "ArrowUp" ? -16 : 16),
      );
      list.style.height = `${this.plugin.data.characterHeight}px`;
      run(() => this.plugin.persist());
    };
    const details = this.contentEl.createDiv({ cls: "anke-details" });
    const heading = details.createDiv({ cls: "anke-toolbar" });
    const avatar = heading.createEl("button", {
      cls: "anke-avatar",
      attr: { "aria-label": "选择人物头像" },
    });
    const first = groups.flatMap((g) =>
      g.entries.map((v) => ({ v, file: g.file })),
    )[0];
    if (character.avatar || first)
      this.thumbnail(
        avatar,
        character.avatar || first.v.url,
        character.avatar ? character.file : first.file,
        "选择头像",
      );
    else avatar.textContent = "头像";
    avatar.onclick = () =>
      new Pick(
        this.app,
        groups.flatMap((g) => g.entries.map((v) => ({ v, file: g.file }))),
        (row) => row.v.label || "（空白描述）",
        (row) =>
          run(async () => {
            const url = library.insertionUrl(
              row.v.url,
              row.file,
              character.file,
            );
            await this.app.fileManager.processFrontMatter(
              character.file,
              (fm) => {
                fm.avatar = url;
              },
            );
          }),
        "选择角色头像",
      ).open();
    this.button(heading, character.name + " ↗", () =>
      run(() => this.openFile(character.file)),
    );
    const color = this.button(heading, "", () => this.chooseColor(character));
    color.addClass("anke-color-button");
    color.setAttribute("aria-label", "角色颜色");
    color.title = `NGA 角色颜色（当前：${character.color}）`;
    color.createSpan({ cls: "anke-color-swatch" }).style.backgroundColor =
      character.color;
    this.button(heading, "⋯", (event) =>
      this.characterMenu(event, project, character),
    );
    if (library.isLegacy(character)) {
      details.createEl("p", {
        text: "这个角色仍使用旧版多文件格式。合并后即可在一个 Markdown 文件里管理全部差分。",
      });
      this.button(details, "合并为单文件…", () =>
        this.plugin.migrateCharacter(project, character),
      );
      return;
    }
    this.button(heading, "+ 分组", () =>
      new Form(
        this.app,
        "添加差分组",
        [{ key: "name", label: "标题" }],
        async (values) => {
          const name = values.name.trim();
          if (!name || /[\r\n]/.test(name)) throw new Error("请输入单行标题。");
          await library.patch(
            character.file,
            (text) => text + `\n\n# ${name}\n\n`,
          );
          await this.openFile(character.file);
          this.plugin.refresh();
        },
        "保存",
        true,
      ).open(),
    );
    const browser = details.createDiv({ cls: "anke-variant-browser" });
    browser.dataset.character = character.file.path;
    if (focusedCharacter) {
      const tree = this.renderOutline(browser, groups, project);
      tree.scrollTop = outlineScroll;
    } else {
      const collapsed = browser.createDiv({ cls: "anke-collapsed-groups" });
      const columns = browser.createDiv({ cls: "anke-variant-columns" });
      let draggedGroup: VariantGroup | undefined;
      for (const group of groups.filter((group) => group.entries.length)) {
        const isCollapsed = this.plugin.data.collapsedGroups.includes(
          group.key,
        );
        const name = group.path;
        const column = isCollapsed
          ? undefined
          : columns.createEl("section", { cls: "anke-variant-group" });
        if (column) column.dataset.path = group.key;
        const header = column
          ? column.createDiv({ cls: "anke-group-header" })
          : collapsed;
        const label = header.createEl("button", {
          cls: `anke-group-heading${isCollapsed ? " anke-group-chip" : ""}`,
          attr: {
            title: `${group.file.path}#${group.path}`,
            "data-group": group.key,
            "aria-expanded": String(!isCollapsed),
            "aria-label": `${isCollapsed ? "展开" : "收起"}${name}`,
          },
        });
        if (isCollapsed) {
          label.createSpan({
            cls: "anke-chip-short",
            text: Array.from(group.path.split(" / ").at(-1)!)[0],
          });
          label.createSpan({ cls: "anke-chip-full", text: name });
        } else label.textContent = name;
        label.onclick = () => {
          this.plugin.data.collapsedGroups = isCollapsed
            ? this.plugin.data.collapsedGroups.filter((p) => p !== group.key)
            : [...this.plugin.data.collapsedGroups, group.key];
          run(async () => {
            await this.plugin.persist();
            await this.render();
            Array.from(
              this.contentEl.querySelectorAll<HTMLButtonElement>(
                ".anke-group-heading",
              ),
            )
              .find((el) => el.dataset.group === group.key)
              ?.focus({ preventScroll: true });
          });
        };
        label.draggable = group.depth > 0;
        label.ondragstart = (event) => {
          if (!event.dataTransfer) return;
          draggedGroup = group;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-anke-group", group.key);
          this.hidePreview();
        };
        const canDrop = () =>
          draggedGroup &&
          draggedGroup.key !== group.key &&
          draggedGroup.depth === group.depth &&
          draggedGroup.parentKey === group.parentKey;
        const dropAfter = (event: DragEvent) => {
          const rect = label.getBoundingClientRect();
          return event.clientX >= rect.left + rect.width / 2;
        };
        label.ondragover = (event) => {
          if (!canDrop()) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          label.dataset.dropSide = dropAfter(event) ? "after" : "before";
        };
        label.ondragleave = () => delete label.dataset.dropSide;
        label.ondragend = () => {
          draggedGroup = undefined;
          for (const target of browser.querySelectorAll<HTMLElement>(
            "[data-drop-side]",
          ))
            delete target.dataset.dropSide;
        };
        label.ondrop = (event) => {
          delete label.dataset.dropSide;
          if (!canDrop()) return;
          event.preventDefault();
          event.stopPropagation();
          const source = draggedGroup!;
          const after = dropAfter(event);
          draggedGroup = undefined;
          run(async () => {
            let keyChanges = new Map<string, string>();
            await library.patch(group.file, (text) => {
              const result = reorderVariantSection(
                text,
                { key: source.sectionKey, headingFrom: source.headingFrom },
                { key: group.sectionKey, headingFrom: group.headingFrom },
                after,
              );
              keyChanges = new Map(
                result.keyChanges.map(([from, to]) => [
                  `${group.file.path}#${from}`,
                  `${group.file.path}#${to}`,
                ]),
              );
              return result.text;
            });
            this.plugin.data.collapsedGroups =
              this.plugin.data.collapsedGroups.map(
                (key) => keyChanges.get(key) ?? key,
              );
            await this.plugin.persist();
            this.plugin.refresh();
          });
        };
        this.acceptVariantDrop(label, (data) => this.moveDroppedVariant(data, group));
        if (column)
          this.acceptVariantDrop(column, (data) => this.moveDroppedVariant(data, group));
        label.oncontextmenu = (event) => {
          event.preventDefault();
          Menu.forEvent(event)
            .setUseNativeMenu(false)
            .addItem((item) =>
              item
                .setTitle("打开角色文件并定位此组")
                .setIcon("file-text")
                .onClick(() => run(() => this.openGroup(group))),
            )
            .showAtMouseEvent(event);
        };
        if (column) {
          const add = this.button(header, "+", () => this.addVariant(group));
          add.addClass("anke-add-variant");
          add.setAttribute("aria-label", `向${name}添加差分`);
          add.title = "添加差分";
          const grid = column.createDiv({
            cls: "anke-variant-grid",
            attr: { tabindex: "0", "aria-label": `${name}差分` },
          });
          const displayed = {
            ...group,
            entries: rankVariants(
              group.entries,
              (entry) => this.usageSnapshot[entry.url],
              this.rankedAt,
            ),
          };
          for (const entry of displayed.entries)
            this.variant(grid, displayed, entry, project);
          grid.onscroll = () => this.hidePreview();
        }
      }
      columns.onscroll = () => this.hidePreview();
      if (!groups.some((g) => g.entries.length))
        details.createEl("p", {
          text: "当前角色没有图片差分。点击角色名打开文件，可在标题右侧添加。",
        });
      columns.scrollLeft = horizontalScroll;
      for (const column of columns.querySelectorAll<HTMLElement>(
        ".anke-variant-group",
      ))
        column.querySelector(".anke-variant-grid")!.scrollTop =
          verticalScroll.get(column.dataset.path!) || 0;
    }
    this.publishingActions(project);
  }
  private publishingActions(project: Project): void {
    const footer = this.contentEl.createDiv({
      cls: "anke-toolbar anke-footer",
    });
    this.button(footer, "发布当前分节", () =>
      run(async () => {
        const { file, editor } = this.plugin.currentWritingEditor(
          this.leaf.getContainer(),
          project,
        );
        await this.plugin.publisher.publishCurrent(file, editor);
      }),
    );
    this.button(footer, "设置自动发布", () =>
      run(async () => {
        const { file, editor } = this.plugin.currentWritingEditor(
          this.leaf.getContainer(),
          project,
        );
        this.plugin.schedule(file, editor);
      }),
    );
    this.button(footer, "发布记录", () => this.plugin.showPublishing(project));
  }
  private renderOutline(
    parent: HTMLElement,
    groups: VariantGroup[],
    project: Project,
  ): HTMLElement {
    const tree = parent.createEl("ul", {
      cls: "anke-outline",
      attr: { "aria-label": "角色标题大纲" },
    });
    const children = new Map<string, HTMLElement>();
    const parents = new Set(groups.map((group) => group.parentKey));
    for (const group of groups) {
      if (!group.depth && !group.entries.length) continue;
      const list = group.parentKey ? children.get(group.parentKey)! : tree;
      const node = list.createEl("li", {
        cls: "anke-outline-node",
        attr: { "data-group": group.key },
      });
      const row = node.createDiv({ cls: "anke-outline-row" });
      this.acceptVariantDrop(row, (data) => this.moveDroppedVariant(data, group));
      const hasContent = !!group.entries.length || parents.has(group.key);
      const content = node.createDiv({ cls: "anke-outline-content" });
      content.hidden =
        this.outlineFolds.get(group.key) ?? !!group.entries.length;
      if (hasContent) {
        const toggle = this.button(row, content.hidden ? "▸" : "▾", () => {
          content.hidden = !content.hidden;
          toggle.textContent = content.hidden ? "▸" : "▾";
          toggle.setAttribute("aria-expanded", String(!content.hidden));
          this.outlineFolds.set(group.key, content.hidden);
          this.hidePreview();
        });
        toggle.addClass("anke-outline-toggle");
        toggle.setAttribute("aria-label", `展开或收起${group.title}`);
        toggle.setAttribute("aria-expanded", String(!content.hidden));
      } else row.createSpan({ cls: "anke-outline-toggle" });
      const label = this.button(row, group.title, () =>
        run(() => this.openGroup(group)),
      );
      label.addClass("anke-outline-heading");
      label.title = group.path;
      label.setAttribute("aria-label", `跳转到${group.title}`);
      const add = this.button(row, "+", () => this.addVariant(group));
      add.addClass("anke-add-variant");
      add.title = "添加差分";
      add.setAttribute("aria-label", `向${group.path}添加差分`);
      if (group.entries.length) {
        const grid = content.createDiv({ cls: "anke-variant-grid" });
        this.acceptVariantDrop(grid, (data) => this.moveDroppedVariant(data, group));
        for (const entry of group.entries)
          this.variant(grid, group, entry, project);
      }
      children.set(
        group.key,
        content.createEl("ul", { cls: "anke-outline-children" }),
      );
    }
    if (!tree.children.length)
      tree.createEl("li", { text: "文件还没有标题，点击「＋ 分组」添加。" });
    tree.onscroll = () => this.hidePreview();
    return tree;
  }
  private chooseColor(character: Character): void {
    const modal = new Modal(this.app);
    modal.setTitle("NGA 角色颜色");
    modal.modalEl.addClass("anke-color-modal");
    modal.contentEl.createEl("p", {
      text: `当前：${character.color}。选择下列色名用于之后的对白上色；已有正文保持原样。`,
    });
    const grid = modal.contentEl.createDiv({ cls: "anke-color-grid" });
    for (const item of NGA_COLORS) {
      const button = grid.createEl("button", {
        attr: {
          type: "button",
          title: item.name,
          "aria-label": `${item.label} (${item.name})`,
          "aria-pressed": String(character.color.toLowerCase() === item.name),
        },
      });
      button.createSpan({ cls: "anke-color-swatch" }).style.backgroundColor =
        item.hex;
      button.createSpan({ text: item.label });
      button.onclick = () =>
        run(async () => {
          await this.app.fileManager.processFrontMatter(
            character.file,
            (fm) => {
              fm.color = item.name;
            },
          );
          modal.close();
          this.plugin.refresh();
        });
    }
    modal.open();
  }
  private async openGroup(group: VariantGroup): Promise<void> {
    const current = variantSections(
      await this.plugin.library.read(group.file),
    ).find((section) => section.key === group.sectionKey);
    if (!current) throw new Error("标题已改变，请刷新后重试。");
    await this.openFile(group.file, current.line);
  }
  private addVariant(group: VariantGroup): void {
    new Form(
      this.app,
      `添加差分 · ${group.path}`,
      [
        { key: "label", label: "描述", placeholder: "可留空" },
        {
          key: "url",
          label: "图片地址",
          placeholder: "https://… 或 Vault 中的图片路径",
        },
      ],
      async (values) => {
        const url = values.url.trim();
        if (!url) throw new Error("请输入图片地址。");
        const link = this.plugin.library.imageLink(
          url,
          group.file,
          group.file,
          values.label,
          false,
        );
        await this.plugin.library.patch(group.file, (text) =>
          appendVariant(text, group.sectionKey, link),
        );
        this.plugin.refresh();
      },
      "保存",
      true,
    ).open();
  }
  private async openFile(file: TFile, line?: number): Promise<void> {
    const leaves = this.app.workspace
      .getLeavesOfType("markdown")
      .filter((leaf) => leaf.getViewState().state?.file === file.path);
    const existing =
      leaves.find((leaf) => leaf.getContainer() === this.leaf.getContainer()) ??
      leaves[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.openFile(
      file,
      line === undefined ? undefined : { eState: { line } },
    );
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (
      line !== undefined &&
      leaf.view instanceof MarkdownView &&
      leaf.view.getMode() === "source"
    ) {
      const point = { line, ch: 0 };
      leaf.view.editor.setCursor(point);
      leaf.view.editor.scrollIntoView({ from: point, to: point }, true);
      leaf.view.editor.focus();
    }
  }
  private button(
    parent: HTMLElement,
    text: string,
    action: (event: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { text });
    button.onclick = action;
    return button;
  }
  private thumbnail(
    parent: HTMLElement,
    url: string,
    file: TFile,
    label: string,
  ): HTMLImageElement {
    const img = parent.createEl("img", {
      attr: { alt: label, loading: "lazy", referrerpolicy: "no-referrer" },
    });
    try {
      img.src = this.plugin.library.resolveMedia(url, file);
    } catch {
      img.alt = "图片不可用";
    }
    return img;
  }
  private acceptVariantDrop(
    element: HTMLElement,
    move: (data: DraggedVariant) => Promise<void>,
  ): void {
    element.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("application/x-anke-variant")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    });
    element.addEventListener("drop", (event) => {
      const raw = event.dataTransfer?.getData("application/x-anke-variant");
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      run(async () => {
        await move(JSON.parse(raw));
      });
    });
  }
  private async moveDroppedVariant(
    data: DraggedVariant,
    group: VariantGroup,
    target?: Variant,
  ): Promise<void> {
    let movedUrl = data.url;
    if (data.file === group.file.path && data.group === group.key) {
      if (!target || data.from === target.from) return;
      await this.plugin.library.patch(group.file, (text) =>
        reorderVariant(text, data, target, group.entries),
      );
    } else {
      const source = this.app.vault.getFileByPath(data.file);
      if (!source) throw new Error("来源角色文件已移除，请刷新后再移动。");
      movedUrl = await this.plugin.library.moveVariant(source, data, group);
    }
    await this.plugin.acceptVariantOrder(
      group.file,
      [...group.entries.map((row) => row.url), movedUrl],
    );
    this.plugin.refresh();
  }
  private variant(
    parent: HTMLElement,
    group: VariantGroup,
    entry: Variant,
    project: Project,
  ): void {
    const row = parent.createDiv({ cls: "anke-variant" });
    const button = row.createEl("button", {
      cls: "anke-thumbnail",
      attr: { draggable: "true" },
    });
    // Obsidian turns aria-label into a tooltip; use image alt for the button's name.
    this.thumbnail(button, entry.url, group.file, `插入${entry.label || "图片"}`);
    const show = () => {
      this.hidePreview();
      const doc = row.ownerDocument,
        rect = button.getBoundingClientRect();
      const preview = doc.body.createDiv({
        cls: "anke-hover-preview is-loading",
      });
      this.preview = preview;
      const img = this.thumbnail(preview, entry.url, group.file, entry.label);
      img.loading = "eager";
      const layout = () => {
        if (this.preview !== preview || !img.naturalWidth || !img.naturalHeight)
          return;
        const viewportWidth = doc.documentElement.clientWidth;
        const viewportHeight = doc.documentElement.clientHeight;
        // Fit the whole image into a readable, bounded preview, including small originals.
        const maxWidth = Math.min(
          180,
          viewportWidth * 0.225,
          viewportWidth - 34,
        );
        const maxHeight = Math.min(
          210,
          viewportHeight * 0.275,
          viewportHeight - 34,
        );
        const scale = Math.min(
          maxWidth / img.naturalWidth,
          maxHeight / img.naturalHeight,
        );
        img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
        img.style.height = `${Math.round(img.naturalHeight * scale)}px`;
        const size = preview.getBoundingClientRect();
        const left = rect.left - size.width - 8;
        const right = rect.right + 8;
        const preferredLeft = left >= 8 ? left : right;
        preview.style.left = `${Math.max(8, Math.min(preferredLeft, viewportWidth - size.width - 8))}px`;
        preview.style.top = `${Math.max(8, Math.min(rect.top, viewportHeight - size.height - 8))}px`;
        preview.removeClass("is-loading");
      };
      img.onload = layout;
      img.onerror = () => {
        if (this.preview === preview) this.hidePreview();
      };
      if (img.complete) layout();
    };
    button.onmouseenter = show;
    button.onfocus = show;
    button.onmouseleave = () => this.hidePreview();
    button.onblur = () => this.hidePreview();
    button.onclick = () =>
      this.plugin.insertVariant(
        entry,
        group.file,
        project,
        this.contentEl.ownerDocument.defaultView!,
      );
    button.ondragstart = (event) => {
      this.hidePreview();
      event.dataTransfer?.setData(
        "application/x-anke-variant",
        JSON.stringify({ file: group.file.path, group: group.key, ...entry }),
      );
      event.dataTransfer?.setData(
        "text/plain",
        markdownLink(entry.label, absoluteNGAImageUrl(entry.url), true),
      );
    };
    this.acceptVariantDrop(row, (data) => this.moveDroppedVariant(data, group, entry));
    const input = row.createEl("input", {
      type: "text",
      value: entry.label,
      attr: { "aria-label": "差分描述", placeholder: "描述可留空" },
    });
    const updateTooltip = () =>
      setTooltip(input, input.value || "描述可留空", { delay: 150 });
    updateTooltip();
    input.oninput = updateTooltip;
    // Commit at blur, never during composition. The source row is checked against concurrent edits.
    let descriptionSave = Promise.resolve();
    input.onblur = () => {
      if (input.value === entry.label) {
        run(() => this.render());
        return;
      }
      const label = input.value;
      descriptionSave = (async () => {
        let updated = entry;
        await this.plugin.library.patch(group.file, (text) => {
          const result = editAndPromoteVariant(
            text,
            entry,
            label,
            group.entries,
          );
          updated = result.entry;
          return result.text;
        });
        entry = updated;
        await this.plugin.acceptVariantOrder(
          group.file,
          group.entries.map((row) => row.url),
        );
        parent.scrollTop = 0;
        this.plugin.refresh();
      })();
      run(() => descriptionSave);
    };
    row.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hidePreview();
      const menu = Menu.forEvent(event).setUseNativeMenu(false);
      for (const size of NGA_IMAGE_SIZES) {
        const url = ngaImageSizeUrl(entry.url, size.value);
        menu.addItem((item) =>
          item
            .setTitle(size.label)
            .setChecked(url === absoluteNGAImageUrl(entry.url))
            .setDisabled(!url)
            .onClick(() => {
              input.blur();
              run(async () => {
                await descriptionSave;
                const nextUrl = ngaImageSizeUrl(entry.url, size.value);
                if (!nextUrl || nextUrl === entry.url) return;
                if (size.value) {
                  new Notice("正在检查所选尺寸的图片……");
                  await verifyNGAImage(nextUrl);
                }
                await this.plugin.library.patch(group.file, (text) =>
                  resizeVariant(text, entry, size.value),
                );
                const usage = this.plugin.data.variantUsage[group.file.path];
                if (usage?.[entry.url] && !usage[nextUrl]) {
                  usage[nextUrl] = { ...usage[entry.url] };
                  await this.plugin.persist();
                }
                if (
                  this.usageSnapshot[entry.url] &&
                  !this.usageSnapshot[nextUrl]
                )
                  this.usageSnapshot[nextUrl] = {
                    ...this.usageSnapshot[entry.url],
                  };
                this.plugin.refresh();
              });
            }),
        );
      }
      menu
        .addSeparator()
        .addItem((item) =>
          item
            .setTitle("删除差分")
            .setIcon("trash")
            .onClick(() => {
              input.blur();
              run(async () => {
                await descriptionSave;
                await this.plugin.library.patch(group.file, (text) =>
                  deleteVariant(text, entry),
                );
                this.plugin.refresh();
              });
            }),
        )
        .showAtMouseEvent(event);
    };
    input.onkeydown = (event) => {
      if (event.key === "Enter" && !event.isComposing) input.blur();
    };
  }
  private hidePreview(): void {
    this.preview?.remove();
    this.preview = undefined;
  }
  private deleteCharacter(project: Project, character: Character): void {
    const modal = new Modal(this.app);
    modal.setTitle(`删除「${character.name}」？`);
    modal.contentEl.createEl("p", {
      text: "角色 Markdown 文件将移入 Vault 垃圾箱。图片附件和其他项目的角色副本会保留。",
    });
    new Setting(modal.contentEl)
      .addButton((button) =>
        button.setButtonText("取消").onClick(() => modal.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("移入垃圾箱")
          .setWarning()
          .onClick(() => {
            button.setDisabled(true);
            run(async () => {
              try {
                await this.plugin.library.deleteCharacter(project, character);
                this.plugin.data.collapsedGroups =
                  this.plugin.data.collapsedGroups.filter(
                    (path) => !path.startsWith(character.file.path + "#"),
                  );
                await this.plugin.persist();
                modal.close();
                this.plugin.refresh();
              } finally {
                button.setDisabled(false);
              }
            });
          }),
      );
    modal.open();
  }
  private visibility(project: Project): void {
    const all = this.plugin.library.characters(project, false),
      visible = this.plugin.library.characters(project);
    const menu = new Menu();
    for (const c of all)
      menu.addItem((item) =>
        item
          .setTitle(c.name)
          .setChecked(visible.some((v) => v.file.path === c.file.path))
          .onClick(() =>
            run(async () => {
              const paths = visible.map((v) => v.file.path);
              await this.plugin.library.setVisible(
                project,
                paths.includes(c.file.path)
                  ? paths.filter((p) => p !== c.file.path)
                  : [...paths, c.file.path],
              );
            }),
          ),
      );
    menu.showAtPosition({
      x: this.contentEl.getBoundingClientRect().left + 12,
      y: this.contentEl.getBoundingClientRect().top + 70,
    });
  }
  private characterMenu(
    event: MouseEvent,
    project: Project,
    character: Character,
  ): void {
    new Menu()
      .addItem((item) =>
        item.setTitle("从其他项目复制角色").onClick(() => {
          const others = this.plugin.library
            .projects()
            .filter((p) => p.file.path !== project.file.path)
            .flatMap((p) =>
              this.plugin.library.characters(p, false).map((c) => ({ p, c })),
            );
          new Pick(
            this.app,
            others,
            (o) => `${o.p.name} / ${o.c.name}`,
            (o) =>
              new Form(
                this.app,
                "复制独立角色",
                [{ key: "name", label: "角色名称", value: o.c.name }],
                async (values) => {
                  await this.plugin.library.copyCharacter(
                    o.c,
                    project,
                    values.name,
                  );
                },
              ).open(),
            "选择要复制的角色",
          ).open();
        }),
      )
      .addItem((item) =>
        item
          .setTitle("从 Vault 图片目录导入差分")
          .onClick(() => this.plugin.importImages(character)),
      )
      .addItem((item) =>
        item.setTitle("批量清空差分描述…").onClick(() =>
          new Form(
            this.app,
            "清空这个角色的全部差分描述",
            [{ key: "confirm", label: "输入「清空」确认；图片链接会保留" }],
            async (values) => {
              if (values.confirm !== "清空")
                throw new Error("请输入「清空」。");
              await this.plugin.library.patch(character.file, (text) => {
                for (const row of this.plugin.library
                  .imageEntries(text, character.file)
                  .reverse())
                  text = editVariant(text, row, "");
                return text;
              });
              this.plugin.refresh();
            },
          ).open(),
        ),
      )
      .showAtMouseEvent(event);
  }
}
