import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const path = "演示作品/1-1 第一章.md";
const note = "演示作品/角色/若叶睦/photo/常服.md";
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for test state");
};
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      // Mac Option changes key (∂, ¡), while the virtual key stays D, 1.
      windowsVirtualKeyCode: /^(Key[A-Z]|Digit[0-9])$/.test(code)
        ? code.at(-1).charCodeAt(0)
        : { Tab: 9, Enter: 13 }[code],
    });
};
const header = "---\nanke-type: chapter\n---\n\n";
const text = () =>
  c.evaluate(`window.ankeTestView.editor.getValue().slice(${header.length})`);
const reset = (value) =>
  call((value) => {
    const v = window.ankeTestView;
    app.workspace.setActiveLeaf(v.leaf, { focus: true });
    v.editor.setValue(value);
    v.editor.setCursor(v.editor.offsetToPos(value.length));
    v.editor.focus();
  }, header + value);
try {
  assert.ok(
    await call(
      (chapter, variants) =>
        !!app.vault.getFileByPath(chapter) &&
        !!app.vault.getFileByPath(variants),
      path,
      note,
    ),
    "This script requires a freshly generated demo vault; it overwrites demo samples.",
  );
  await call(async (path) => {
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source" },
      active: true,
    });
    window.ankeTestView = leaf.view;
    await app.plugins.plugins["anke-writing"].openCharacters();
  }, path);
  await reset("“Hello” 「World」");
  await key("¡", "Digit1", 1);
  await waitFor(() => c.evaluate("window.ankeTestView.editor.hasFocus()"));
  assert.equal(
    await text(),
    "“[color=#6b9e83]Hello[/color]” 「[color=#6b9e83]World[/color]」",
  );
  await key("z", "KeyZ", 4);
  assert.equal(await text(), "“Hello” 「World」");
  console.log("PASS: Alt+1 and native Cmd+Z restore the exact original text");

  await reset("start ");
  await key("∂", "KeyD", 1);
  await waitFor(() => c.evaluate("window.ankeTestView.editor.hasFocus()"));
  assert.equal(await text(), "start [dice]1d100[/dice]");
  assert.equal(
    await c.evaluate(
      "window.ankeTestView.editor.posToOffset(window.ankeTestView.editor.getCursor())",
    ),
    header.length + 17,
  );
  await key("z", "KeyZ", 4);
  assert.equal(await text(), "start ");
  console.log("PASS: Alt+D places the cursor after 100 and undoes in one step");

  await reset("**Hello**\n\n[dice]1d100[/dice]");
  // Verify the export command without replacing the user's system clipboard.
  await c.evaluate(`window.ankeClipboardWrite = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async text => { window.ankeClipboardResult = text; };`);
  try {
    await key("ç", "KeyC", 1);
    assert.equal(
      await c.evaluate("window.ankeClipboardResult"),
      "[b]Hello[/b]\n\n[dice]1d100[/dice]",
    );
  } finally {
    await c.evaluate(
      "navigator.clipboard.writeText = window.ankeClipboardWrite",
    );
  }
  console.log(
    "PASS: Mac Option+C dispatches BBCode export with the ç key",
  );

  await reset("[quo");
  await key("Tab", "Tab");
  assert.equal(await text(), "[quote][/quote]");
  assert.equal(
    await c.evaluate("window.ankeTestView.editor.getCursor().ch"),
    7,
  );
  console.log("PASS: Tab confirms tag completion");

  await reset("Text\n---重逢");
  await key("Enter", "Enter");
  assert.equal(await text(), 'Text\n\n---\n<!-- anke-section: "重逢" -->\n\n');
  await reset("Text\n---");
  await key("Enter", "Enter");
  assert.equal(await text(), "Text\n\n---\n\n");
  console.log(
    "PASS: typed plain/named separators normalize to real Markdown boundaries",
  );

  await c.evaluate(`app.plugins.plugins['anke-writing'].refresh()`);
  await waitFor(() =>
    c.evaluate(`!!document.querySelector('.anke-variant input')`),
  );
  await c.evaluate(
    `(()=>{const input=document.querySelector('.anke-variant input');input.focus();input.select();})()`,
  );
  await c.send("Input.imeSetComposition", {
    text: "中文",
    selectionStart: 2,
    selectionEnd: 2,
  });
  assert.equal(await c.evaluate(`document.activeElement.value`), "中文");
  await c.send("Input.insertText", { text: "中文描述" });
  await c.evaluate(`document.activeElement.blur()`);
  await waitFor(() =>
    call(
      async (path) =>
        (
          await app.plugins.plugins["anke-writing"].library.read(
            app.vault.getFileByPath(path),
          )
        ).includes("[中文描述]"),
      note,
    ),
  );
  const other = note.replace("演示作品", "另一部作品");
  assert.ok(
    !(
      await call(
        async (path) => app.vault.read(app.vault.getFileByPath(path)),
        other,
      )
    ).includes("[中文描述]"),
  );
  console.log(
    "PASS: IME caption commit survives sidebar refresh and does not change another project",
  );

  await call(async (note) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "preview" },
      active: true,
    });
  }, note);
  await c.send("Page.bringToFront");
  await c.screenshot("/tmp/anke-reading-paint.png");
  await waitFor(() =>
    c.evaluate(
      `document.querySelectorAll('.markdown-reading-view .anke-reading-image').length>=2`,
    ),
  );
  assert.equal(
    await call(
      async (note) =>
        (await app.vault.read(app.vault.getFileByPath(note))).includes("!["),
      note,
    ),
    false,
  );
  console.log(
    "PASS: variant Reading view renders images without rewriting source links",
  );
  await c.screenshot("/tmp/anke-obsidian-native-tested.png");
} finally {
  c.close();
}
