import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const root = `FullwidthCheck-${Date.now()}`;
const key = async (modifiers) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: modifiers === 12 ? "Z" : "z",
      code: "KeyZ",
      windowsVirtualKeyCode: 90,
      modifiers,
    });
};
const setText = async (text, ranges = []) =>
  call(
    (text, ranges) => {
      const editor = window.fullwidthCheck.leaf.view.editor;
      editor.setValue(text);
      if (ranges.length)
        editor.setSelections(
          ranges.map(([a, b]) => ({
            anchor: editor.offsetToPos(a),
            head: editor.offsetToPos(b),
          })),
        );
      else editor.setCursor({ line: 0, ch: 0 });
      editor.focus();
    },
    text,
    ranges,
  );
const value = () =>
  call(() => window.fullwidthCheck.leaf.view.editor.getValue());
const convert = () =>
  call(() =>
    app.commands.executeCommandById("anke-writing:halfwidth-to-fullwidth"),
  );
try {
  await c.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await call(async (root) => {
    if (document.querySelector(".modal,.prompt"))
      throw Error("Close dialogs before testing");
    window.fullwidthCheck = {
      active: app.workspace.activeLeaf,
      leaf: app.workspace.getLeaf("tab"),
    };
    await app.vault.createFolder(root);
    await app.vault.create(root + "/普通笔记.md", "");
  }, root);
  assert.ok(
    await call(() =>
      app.commands.commands[
        "anke-writing:halfwidth-to-fullwidth"
      ].name.includes("半角->全角"),
    ),
  );
  const input =
    '他说: "你好, world!" (继续...)\n\n[dice]1d100[/dice]\n[color=skyblue]试试, 好?[/color]\n\n[图片, 好!](https://e.test/a(b).png)';
  const expected =
    "他说：“你好，world！”（继续……）\n\n[dice]1d100[/dice]\n[color=skyblue]试试，好？[/color]\n\n[图片, 好!](https://e.test/a(b).png)";
  for (const source of [true, false]) {
    await call(
      async (root, source) => {
        const leaf = window.fullwidthCheck.leaf;
        await leaf.setViewState({
          type: "markdown",
          state: { file: root + "/普通笔记.md", mode: "source", source },
          active: true,
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      root,
      source,
    );
    await setText(input);
    assert.equal(await convert(), true);
    assert.equal(await value(), expected);
    await key(4);
    assert.equal(await value(), input, "One Cmd+Z restores the original text");
    await key(12);
    assert.equal(
      await value(),
      expected,
      "Native redo restores converted text",
    );
    const before = "before, keep!\n",
      after = "\nafter, keep!";
    await setText(before + input + after, [
      [before.length, before.length + input.length],
    ]);
    await convert();
    assert.equal(
      await value(),
      before + expected + after,
      "Only the selected text changes",
    );
    await key(4);
    assert.equal(await value(), before + input + after);
    const multiple = "A, B!\nuntouched, yes!\n(C?)";
    await setText(multiple, [
      [0, 5],
      [multiple.length - 4, multiple.length],
    ]);
    await convert();
    assert.equal(await value(), "A，B！\nuntouched, yes!\n（C？）");
    await key(4);
    assert.equal(await value(), multiple, "All selections undo together");
    console.log(
      `PASS (${source ? "source" : "live preview"}): command registration, ordinary Markdown file, complete file and multiple selections, protected Markdown/NGA syntax, one-step undo and redo.`,
    );
  }
} finally {
  await call(async (root) => {
    const state = window.fullwidthCheck;
    if (!state) return;
    if (state.leaf.view.save) await state.leaf.view.save();
    await state.leaf.setViewState({ type: "empty", state: {} });
    state.leaf.detach();
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    delete window.fullwidthCheck;
  }, root);
  c.close();
}
