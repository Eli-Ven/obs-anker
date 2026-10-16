import { editorInfoField, editorLivePreviewField } from "obsidian";
import {
  EditorState,
  Prec,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import type AnkePlugin from "./main";
import { completion, protectedRanges, overlaps, parse } from "./document";
import { contextQuote } from "./punctuation";

class Hint extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "anke-completion";
    el.textContent = "Tab 补全";
    return el;
  }
}
class Badge extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: Badge): boolean {
    return this.label === other.label;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "anke-badge";
    el.textContent = this.label;
    return el;
  }
}
export function editorExtensions(plugin: AnkePlugin): Extension[] {
  function enabled(state: EditorState): boolean {
    return !!plugin.library.chapterProject(
      state.field(editorInfoField, false)?.file ?? null,
    );
  }
  const preview = StateField.define<{
    tree: ReturnType<typeof parse> | null;
    decorations: DecorationSet;
  }>({
    create: () => ({ tree: null, decorations: Decoration.none }),
    update(previous, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        !transaction.reconfigured &&
        !transaction.effects.length
      )
        return previous;
      const state = transaction.state,
        file = state.field(editorInfoField, false)?.file;
      if (!plugin.library.chapterProject(file ?? null))
        return { tree: null, decorations: Decoration.none };
      const text = state.doc.toString(),
        caret = state.selection.main.head;
      const ranges: ReturnType<Decoration["range"]>[] = [];
      const suggestion = completion(text, caret);
      if (suggestion && state.selection.main.empty)
        ranges.push(
          Decoration.widget({ widget: new Hint(), side: 1 }).range(caret),
        );
      let tree = transaction.docChanged ? null : previous.tree;
      if (state.field(editorLivePreviewField, false)) {
        tree ??= parse(text);
        const blocked = protectedRanges(text, false, true, tree);
        const editing = (from: number, to: number) =>
          state.selection.ranges.some((r) => r.from <= to && r.to >= from);
        for (const match of text.matchAll(
          /\[color=([a-z]+|#[a-f\d]{3,8})\]([^\n]*?)\[\/color\]/gi,
        )) {
          const from = match.index!,
            to = from + match[0].length;
          if (overlaps(blocked, from, to) || editing(from, to)) continue;
          const openEnd = from + match[0].indexOf("]") + 1,
            closeStart = to - "[/color]".length;
          if (openEnd === closeStart) continue;
          ranges.push(
            Decoration.replace({}).range(from, openEnd),
            Decoration.mark({
              attributes: { style: `color:${match[1]}` },
            }).range(openEnd, closeStart),
            Decoration.replace({}).range(closeStart, to),
          );
        }
        for (const match of text.matchAll(/\[dice\](\d+d\d+)\[\/dice\]/g)) {
          const from = match.index!,
            to = from + match[0].length;
          if (!overlaps(blocked, from, to) && !editing(from, to))
            ranges.push(
              Decoration.replace({
                widget: new Badge(`NGA 🎲 ${match[1]}`),
              }).range(from, to),
            );
        }
        const literalRanges = protectedRanges(text, false, false, tree);
        for (const match of text.matchAll(
          /^\[timingpost([^\]\n]*)\]$|^\[\/timingpost\]$|^<!-- anke-section: ("[^\n]*") -->$/gm,
        )) {
          const from = match.index!,
            to = from + match[0].length;
          if (
            editing(from, to) ||
            overlaps(match[2] ? literalRanges : blocked, from, to)
          )
            continue;
          let label = "分节结束";
          if (match[2]) {
            try {
              label = "分节 · " + JSON.parse(match[2]);
            } catch {
              continue;
            }
          } else if (match[1] !== undefined) {
            const time = match[1].match(/time="([^"]+)"/)?.[1];
            const floor = match[1].match(/floor="(\d+)"/)?.[1];
            label = time
              ? "计划发布 · " + time
              : floor
                ? "已发 · " + floor + " 楼"
                : /sent=|marked=|pid=/.test(match[1])
                  ? "已发布"
                  : "待发布";
          }
          ranges.push(
            Decoration.replace({ widget: new Badge(label) }).range(from, to),
          );
        }
      }
      return { tree, decorations: Decoration.set(ranges, true) };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
  return [
    preview,
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text, insert) => {
        const { state } = view,
          range = state.selection.main;
        if (
          !/^[“”‘’「」『』]$/.test(text) ||
          !enabled(state) ||
          state.readOnly ||
          view.compositionStarted ||
          state.selection.ranges.length !== 1 ||
          from !== range.from ||
          to !== range.to ||
          !(
            plugin.app.vault as typeof plugin.app.vault & {
              getConfig(key: string): unknown;
            }
          ).getConfig("autoPairBrackets") ||
          !insert().isUserEvent("input.type")
        )
          return false;
        const result = contextQuote(state.doc.toString(), from, to, text);
        if (!result) return false;
        const { anchor, head } = result;
        view.dispatch({
          changes: { from, to, insert: result.insert },
          selection:
            range.anchor > range.head
              ? { anchor: head, head: anchor }
              : { anchor, head },
          userEvent: result.insert ? "input.type" : "select",
          scrollIntoView: true,
        });
        return true;
      }),
    ),
    Prec.highest(
      EditorState.languageData.of((state, pos) => {
        if (
          !enabled(state) ||
          overlaps(protectedRanges(state.doc.toString(), true), pos)
        )
          return [];
        return [
          {
            closeBrackets: {
              // Keep Obsidian's Markdown pairs and extend its native pairing behavior.
              brackets: [
                "(",
                "[",
                "{",
                "'",
                '"',
                "*",
                "_",
                "`",
                "```",
                "“",
                "‘",
                "「",
                "『",
                "（",
                "【",
                "《",
                "〈",
                "〔",
              ],
              before: ")]};:>”’」』）】》〉〕",
            },
          },
        ];
      }),
    ),
    Prec.highest(
      keymap.of([
        {
          key: "Tab",
          run(view) {
            if (
              !enabled(view.state) ||
              view.composing ||
              !view.state.selection.main.empty
            )
              return false;
            const suggestion = completion(
              view.state.doc.toString(),
              view.state.selection.main.head,
            );
            if (!suggestion) return false;
            view.dispatch({
              changes: suggestion,
              selection: {
                anchor: suggestion.from + suggestion.insert.indexOf("]") + 1,
              },
              userEvent: "input.complete",
            });
            return true;
          },
        },
        {
          key: "Enter",
          run(view) {
            if (
              !enabled(view.state) ||
              view.compositionStarted ||
              !view.state.selection.main.empty
            )
              return false;
            const caret = view.state.selection.main.head,
              line = view.state.doc.lineAt(caret),
              text = view.state.doc.toString();
            const quotes = text.slice(caret, line.to).match(/^[”’」』]+|^"/);
            const beforeQuote = text
              .slice(line.from, caret)
              .replace(/\\./g, "");
            if (
              quotes &&
              !view.state.readOnly &&
              view.state.selection.ranges.length === 1 &&
              !overlaps(protectedRanges(text, true), caret) &&
              (quotes[0] !== '"' ||
                (!beforeQuote.endsWith("\\") &&
                  (beforeQuote.match(/"/g)?.length ?? 0) % 2 === 1))
            ) {
              view.dispatch({
                selection: { anchor: caret + quotes[0].length },
              });
              // Let Obsidian continue Markdown lists/quotes and apply its normal newline.
              return false;
            }
            if (
              caret !== line.to ||
              !/^---(?:[^-\n].*)?$/.test(line.text) ||
              overlaps(protectedRanges(text), line.from, line.to)
            )
              return false;
            const name = line.text.slice(3).trim();
            const prefix =
              line.number > 1 &&
              view.state.doc.line(line.number - 1).text.trim()
                ? "\n"
                : "";
            const insert = name
              ? `${prefix}---\n<!-- anke-section: ${JSON.stringify(name).replace(/-->/g, "--\\u003e")} -->\n\n`
              : `${prefix}---\n\n`;
            view.dispatch({
              changes: { from: line.from, to: line.to, insert },
              selection: { anchor: line.from + insert.length },
              userEvent: "input",
            });
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      drop(event, view) {
        const raw = event.dataTransfer?.getData("application/x-anke-variant");
        if (!raw || !enabled(view.state)) return false;
        const target = view.state.field(editorInfoField, false)?.file;
        if (!target) return false;
        try {
          const data = JSON.parse(raw);
          const source = plugin.app.vault.getFileByPath(data.file);
          if (!source) return false;
          const offset = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          if (offset === null) return false;
          const insert = plugin.library.imageLink(
            data.url,
            source,
            target,
            data.label,
          );
          event.preventDefault();
          view.dispatch({
            changes: { from: offset, insert },
            selection: { anchor: offset + insert.length },
            userEvent: "input.drop",
          });
          plugin.recordVariantUse(source, data.url);
          view.focus();
          return true;
        } catch (error) {
          plugin.error(error);
          return true;
        }
      },
    }),
  ];
}
