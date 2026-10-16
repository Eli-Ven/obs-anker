import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const root = `PunctuationCheck-${Date.now()}`;
// Allow DOM input to flush without waiting on animation frames in a hidden window.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode:
        code === "KeyZ" ? 90 : { Enter: 13, Backspace: 8, Tab: 9 }[code],
    });
  await settle();
};
const insert = async (text) => {
  await c.send("Input.insertText", { text });
  await settle();
};
const setText = async (text, anchor = text.length, head = anchor) => {
  await call(
    (text, anchor, head) => {
      const e = window.ankePunctuationCheck.leaf.view.editor;
      e.setValue(text);
      e.setSelection(e.offsetToPos(anchor), e.offsetToPos(head));
      e.focus();
    },
    text,
    anchor,
    head,
  );
  await settle();
};
const snapshot = () =>
  call(() => {
    const e = window.ankePunctuationCheck.leaf.view.editor;
    return { text: e.getValue(), cursor: e.posToOffset(e.getCursor()) };
  });
const expect = async (text, cursor = text.length) =>
  assert.deepEqual(await snapshot(), { text, cursor });
const open = async (path, source) => {
  await call(
    async (path, source) => {
      const { leaf } = window.ankePunctuationCheck;
      await leaf.setViewState({
        type: "markdown",
        state: { file: path, mode: "source", source },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      leaf.view.editor.focus();
    },
    path,
    source,
  );
  await settle();
};
try {
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    window.ankePunctuationCheck = {
      active: app.workspace.activeLeaf,
      characterPath: p.views()[0]?.characterPath,
      leaf: app.workspace.getLeaf("tab"),
      root,
      autoPairBrackets: app.vault.getConfig("autoPairBrackets"),
    };
    if (!app.vault.getConfig("autoPairBrackets"))
      throw new Error("Enable auto-pair brackets for this test");
    await p.library.createProject(root);
    await app.vault.create(`${root}/普通笔记.md`, "");
  }, root);
  // Wait for the new project metadata, never alter an existing writing project.
  for (let i = 0; i < 100; i++) {
    if (
      await call(
        (root) =>
          app.plugins.plugins["anke-writing"].library
            .projects()
            .some((p) => p.root === root),
        root,
      )
    )
      break;
    if (i === 99) throw new Error("Project metadata was not indexed");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const source of [true, false]) {
    await open(`${root}/1-1 第一章.md`, source);
    assert.equal(
      await call(() => window.ankePunctuationCheck.leaf.view.getState().source),
      source,
    );
    for (const [left, right] of [
      "“”",
      "‘’",
      "「」",
      "『』",
      "（）",
      "【】",
      "《》",
      "〈〉",
      "〔〕",
      "()",
      "[]",
      "{}",
      '\"\"',
    ]) {
      await setText("");
      await insert(left);
      await expect(left + right, 1);
      await key("Backspace", "Backspace");
      await expect("");
      await insert(left);
      await insert("你好");
      await insert(right);
      await expect(left + "你好" + right);
    }
    // Rime alternates quote direction even when Enter used the auto-inserted closer.
    await setText("");
    await insert("“");
    await insert("第一句");
    await key("Enter", "Enter");
    await expect("“第一句”\n");
    await insert("”");
    await expect("“第一句”\n“”", 7);
    await insert("第二句");
    await insert("“");
    await expect("“第一句”\n“第二句”");
    await key("Enter", "Enter");
    await insert("”");
    await expect("“第一句”\n“第二句”\n“”", 13);
    await key("Backspace", "Backspace");
    await expect("“第一句”\n“第二句”\n");

    for (const [before, caret, input, after, next] of [
      ["“未闭合", 4, "“", "“未闭合”", 5],
      ["“已有”", 3, "“", "“已有”", 4],
      ["“已有”", 3, "”", "“已有”", 4],
      ["“跨行\n对白", 6, "“", "“跨行\n对白”", 7],
      ["“上段未闭合\n\n", 8, "”", "“上段未闭合\n\n“”", 9],
      ["“外层”", 3, "’", "“外层‘’”", 4],
    ]) {
      await setText(before, caret);
      await insert(input);
      await expect(after, next);
    }
    // Compare redo selection with Obsidian's own bracket-pair behavior.
    await setText("");
    await insert("(");
    await expect("()", 1);
    await key("z", "KeyZ", 4);
    await expect("");
    await key("Z", "KeyZ", 12);
    const nativeRedo = await snapshot();
    assert.equal(nativeRedo.text, "()");
    await setText("");
    await insert("”");
    await expect("“”", 1);
    await key("z", "KeyZ", 4);
    await expect("");
    await key("Z", "KeyZ", 12);
    await expect("“”", nativeRedo.cursor);

    await setText("你好", 2, 0);
    await insert("”");
    assert.equal((await snapshot()).text, "“你好”");
    assert.equal(
      await call(() =>
        window.ankePunctuationCheck.leaf.view.editor.getSelection(),
      ),
      "你好",
    );
    await key("z", "KeyZ", 4);
    assert.equal((await snapshot()).text, "你好");
    // A paste is literal, even when it contains just one quote.
    await setText("");
    await call(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "”");
      window.ankePunctuationCheck.leaf.view.editor.cm.contentDOM.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    await expect("”");
    console.log(
      `PASS (${source ? "source" : "live preview"}): alternating IME quotes, paragraph context, existing closers, nested quote types, undo/redo, backward selection and literal paste`,
    );

    await setText("你好", 0, 2);
    await insert("「");
    assert.equal((await snapshot()).text, "「你好」");
    assert.deepEqual(
      await call(() =>
        window.ankePunctuationCheck.leaf.view.editor.getSelection(),
      ),
      "你好",
    );
    await key("z", "KeyZ", 4);
    assert.equal((await snapshot()).text, "你好");
    await key("Z", "KeyZ", 12);
    assert.equal((await snapshot()).text, "「你好」");
    console.log(
      `PASS (${source ? "source" : "live preview"}): Chinese and English pairs, caret, skip-close, pair deletion, selection wrapping, undo/redo`,
    );

    for (const [before, caret, after, next] of [
      ["“你好”", 3, "“你好”\n", 5],
      ["『「你好」』", 4, "『「你好」』\n", 7],
      ['"你好"', 3, '"你好"\n', 5],
      ["- “你好”", 5, "- “你好”\n- ", 9],
      ["> 「你好」", 5, "> 「你好」\n> ", 9],
      ["“你好”后文", 3, "“你好”\n后文", 5],
      ["“你好”", 2, "“你\n好”", 3],
      ['前文"你好"', 2, '前文\n"你好"', 3],
    ]) {
      await setText(before, caret);
      await key("Enter", "Enter");
      await expect(after, next);
      await key("z", "KeyZ", 4);
      assert.equal((await snapshot()).text, before);
    }
    await setText("“你好”", 3);
    await key("Enter", "Enter", 8);
    assert.equal((await snapshot()).text, "“你好\n”");
    console.log(
      `PASS (${source ? "source" : "live preview"}): Enter keeps closing quotes on the previous line, native list/quote continuation and undo, normal mid-sentence/Shift+Enter behavior`,
    );

    for (const [text, caret] of [
      ["```\n\n```", 4],
      ...(source ? [["---\nname: \n---", 10]] : []),
      ["`ab`", 2],
      ["[ab](https://example.com)", 2],
    ]) {
      await setText(text, caret);
      await insert("“");
      await expect(text.slice(0, caret) + "“" + text.slice(caret), caret + 1);
    }
    await setText("```\n“你好”\n```", 7);
    await key("Enter", "Enter");
    assert.equal((await snapshot()).text, "```\n“你好\n”\n```");
    await setText("---重逢");
    await key("Enter", "Enter");
    assert.equal(
      (await snapshot()).text,
      '---\n<!-- anke-section: "重逢" -->\n\n',
    );
    await setText("[quote]");
    await key("Tab", "Tab");
    await expect("[quote][/quote]", 7);
    console.log(
      `PASS (${source ? "source" : "live preview"}): code/YAML/links stay literal; section lines and Tab completion still work`,
    );
  }
  await setText("");
  await c.send("Input.imeSetComposition", {
    text: "ni",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await c.send("Input.insertText", { text: "你好" });
  await settle();
  await expect("你好");
  await insert("”");
  await expect("你好“”", 3);
  await key("z", "KeyZ", 4);
  assert.equal((await snapshot()).text.includes("z"), false);
  console.log(
    "PASS: IME text commit followed by paired punctuation and Cmd+Z does not inject key text",
  );

  await call(() => app.vault.setConfig("autoPairBrackets", false));
  await setText("");
  await insert("”");
  await expect("”");
  await call(() => app.vault.setConfig("autoPairBrackets", true));
  console.log(
    "PASS: disabling native auto-pair also disables contextual quotes",
  );

  await open(`${root}/普通笔记.md`, true);
  await setText("");
  await insert("“");
  await expect("“");
  await setText("“你好”", 3);
  await key("Enter", "Enter");
  await expect("“你好\n”", 4);
  console.log(
    "PASS: ordinary notes retain original pairing and Enter behavior",
  );
} finally {
  try {
    await call(async () => {
      const check = window.ankePunctuationCheck;
      if (!check) return;
      app.vault.setConfig("autoPairBrackets", check.autoPairBrackets);
      if (check.leaf.view.save) await check.leaf.view.save();
      await check.leaf.setViewState({ type: "empty", state: {} });
      check.leaf.detach();
      const folder = app.vault.getFolderByPath(check.root);
      if (folder) await app.vault.trash(folder, false);
      if (check.active?.parent)
        app.workspace.setActiveLeaf(check.active, { focus: true });
      const panel = app.plugins.plugins["anke-writing"]?.views()[0];
      if (panel) {
        panel.characterPath = check.characterPath;
        panel.render();
      }
      delete window.ankePunctuationCheck;
    });
  } finally {
    c.close();
  }
}
