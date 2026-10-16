import {
  App,
  prepareSimpleSearch,
  sortSearchResults,
  SuggestModal,
  type SearchResult,
} from "obsidian";
import { rankVariants, type VariantUsage } from "./variant-ranking";
import type { Character, VariantGroup } from "./library";
import type { Variant } from "./document";

export interface VariantChoice {
  character: Character;
  group: VariantGroup;
  entry: Variant;
}
export class VariantSearch extends SuggestModal<VariantChoice> {
  private scopeEl: HTMLElement;
  private usage = new Map<VariantChoice, VariantUsage | undefined>();
  private rankedAt = Date.now();
  private previewEl: HTMLElement;
  private previewChoice?: VariantChoice;
  private rows = new WeakMap<HTMLElement, VariantChoice>();
  private previewObserver = new MutationObserver(() => this.updatePreview());
  constructor(
    app: App,
    readonly choices: VariantChoice[],
    readonly selected: string | undefined,
    readonly collapsed: Set<string>,
    readonly choose: (choice: VariantChoice) => void,
    readonly imageSource: (choice: VariantChoice) => string,
    usage: (choice: VariantChoice) => VariantUsage | undefined,
  ) {
    super(app);
    for (const row of choices) this.usage.set(row, usage(row));
    this.setPlaceholder("搜索角色、分组或差分…");
    this.emptyStateText = "当前作品没有匹配的差分。";
    this.scopeEl = this.inputEl.ownerDocument.createElement("div");
    this.scopeEl.className = "anke-search-scope";
    this.scopeEl.setAttribute("aria-live", "polite");
    this.inputEl.insertAdjacentElement("afterend", this.scopeEl);
    this.modalEl.addClass("anke-variant-search");
    const body = this.resultContainerEl.ownerDocument.createElement("div");
    body.className = "anke-search-body";
    this.resultContainerEl.insertAdjacentElement("beforebegin", body);
    this.previewEl = body.createDiv({
      cls: "anke-search-preview",
      attr: { "aria-label": "差分预览" },
    });
    body.append(this.resultContainerEl);
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "Enter", purpose: "插入" },
      { command: "Esc", purpose: "取消" },
    ]);
  }
  onOpen(): void {
    // SuggestModal has no public highlight callback. Observe its selection classes
    // so keyboard and mouse navigation keep the same native selection behavior.
    this.previewObserver.observe(this.resultContainerEl, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    super.onOpen();
    this.updatePreview();
  }
  onClose(): void {
    this.previewObserver.disconnect();
    this.previewChoice = undefined;
    this.previewEl.empty();
    super.onClose();
  }
  private updatePreview(): void {
    const selected = this.resultContainerEl.querySelector<HTMLElement>(
      ".suggestion-item.is-selected",
    );
    const choice = selected ? this.rows.get(selected) : undefined;
    if (choice === this.previewChoice) return;
    this.previewChoice = choice;
    this.previewEl.empty();
    if (!choice) return;
    const status = this.previewEl.createDiv({
      cls: "anke-search-preview-status",
      text: "正在加载图片…",
    });
    try {
      const src = this.imageSource(choice);
      const img = this.previewEl.createEl("img", {
        attr: {
          alt: choice.entry.label || "差分图片",
          referrerpolicy: "no-referrer",
        },
      });
      img.hidden = true;
      img.onload = () => {
        status.remove();
        img.hidden = false;
      };
      img.onerror = () => {
        img.remove();
        status.setText("图片无法加载");
      };
      img.src = src;
    } catch {
      status.setText("图片不可用");
    }
  }
  getSuggestions(query: string): VariantChoice[] {
    const text = query.trim();
    const terms = text ? text.split(/\s+/).map(prepareSimpleSearch) : [];
    const scores = new Map<VariantChoice, SearchResult>();
    const matches = this.choices.filter((row) => {
      if (!text) return true;
      const fields = [row.entry.label, row.character.name, row.group.path];
      let score = 0;
      for (const match of terms) {
        const results = fields.flatMap((field) => {
          const result = match(field);
          return result ? [{ match: result }] : [];
        });
        if (!results.length) return false;
        sortSearchResults(results);
        score += results[0].match.score;
      }
      scores.set(row, { score, matches: [] });
      return true;
    });
    const scopes = [
      {
        name: "当前角色 · 已展开分组",
        rows: matches.filter(
          (r) =>
            r.character.file.path === this.selected &&
            !this.collapsed.has(r.group.key),
        ),
      },
      {
        name: "当前角色 · 全部差分",
        rows: matches.filter((r) => r.character.file.path === this.selected),
      },
      { name: "当前作品 · 全部角色", rows: matches },
    ];
    const result = scopes.find((scope) => scope.rows.length) ?? scopes[2];
    this.scopeEl.textContent = `${result.name} · ${result.rows.length} 个结果`;
    const ranked = rankVariants(
      result.rows,
      (row) => this.usage.get(row),
      this.rankedAt,
    );
    if (!text) return ranked;
    const scored = ranked.map((row) => ({ row, match: scores.get(row)! }));
    sortSearchResults(scored);
    return scored.map(({ row }) => row);
  }
  renderSuggestion(row: VariantChoice, el: HTMLElement): void {
    this.rows.set(el, row);
    el.createDiv({ text: row.entry.label || "（空白描述）" });
    el.createDiv({
      cls: "anke-search-source",
      text: `${row.character.name} / ${row.group.path}`,
    });
  }
  onChooseSuggestion(row: VariantChoice): void {
    this.choose(row);
  }
}
