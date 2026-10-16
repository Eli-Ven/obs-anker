import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = async (fn, ...args) => {
  for (let i = 0; i < 120; i++) {
    if (await call(fn, ...args)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Group layout condition timed out");
};
const root = `GroupLayoutCheck-${Date.now()}`;
let role;
const open = async (path) => {
  await call(async (path) => {
    const leaf = window.groupLayoutCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: true },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await app.plugins.plugins["anke-writing"].views()[0].render();
  }, path);
};
const folded = (title) =>
  call(
    (title) =>
      [...document.querySelectorAll(".anke-outline-heading")]
        .find((el) => el.textContent === title)
        .closest("li")
        .querySelector(".anke-outline-content").hidden,
    title,
  );
const toggle = (title) =>
  call(
    (title) =>
      [...document.querySelectorAll(".anke-outline-heading")]
        .find((el) => el.textContent === title)
        .parentElement.querySelector(".anke-outline-toggle")
        .click(),
    title,
  );
const drag = (from, to, after) =>
  call(
    (from, to, after) => {
      const labels = [...document.querySelectorAll(".anke-group-heading")];
      const source = labels.find((el) =>
        el.dataset.group.endsWith("#" + encodeURIComponent(from) + ":1"),
      );
      const target = labels.find((el) =>
        el.dataset.group.endsWith("#" + encodeURIComponent(to) + ":1"),
      );
      window.groupLayoutCheck.dragLabel = source;
      const dt = new DataTransfer(),
        rect = target.getBoundingClientRect();
      const init = {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: after ? rect.right - 1 : rect.left + 1,
        clientY: rect.top + 5,
      };
      source.dispatchEvent(
        new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
      );
      const allowed = !target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
      source.dispatchEvent(
        new DragEvent("dragend", { dataTransfer: dt, bubbles: true }),
      );
      return allowed;
    },
    from,
    to,
    after,
  );
try {
  await c.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await call(async (root) => {
    if (document.querySelector(".modal"))
      throw Error("Close dialogs before running this check");
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    const p = app.plugins.plugins["anke-writing"];
    await p.openCharacters();
    window.groupLayoutCheck = {
      active: app.workspace.activeLeaf,
      character: p.views()[0].characterPath,
      leaf: app.workspace.getLeaf("tab"),
      write: navigator.clipboard.writeText,
    };
    await p.library.createProject(root);
    await app.vault.create(
      root + "/portrait.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="#abc"/></svg>',
    );
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((p) => p.root === root),
    root,
  );
  role = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((p) => p.root === root);
    const file = await p.library.createCharacter(project, "Layout");
    const prefix = "---\nanke-type: character\nname: Layout\n---\n\n";
    const a =
      "# 常服\n- [常服图](../portrait.svg)\nKeep A.\n\n## 说明\nKeep child notes.\n\n";
    const b = "# 设定\nKeep B.\n\n## 演出服\n- [演出服图](../portrait.svg)\n\n";
    const d = "# 冬服\n- [冬服图](../portrait.svg)\n";
    window.groupLayoutCheck.original = prefix + a + b + d;
    window.groupLayoutCheck.expected = prefix + b + d + "\n" + a;
    await app.vault.modify(file, window.groupLayoutCheck.original);
    return file.path;
  }, root);
  const chapter = root + "/1-1 第一章.md";
  await open(chapter);
  await wait(
    (path) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
      path,
    role,
  );
  // Persist a writing-column fold, then inspect the independent defaults in the role outline.
  await call(() =>
    [...document.querySelectorAll(".anke-group-heading")]
      .find((el) => el.textContent === "常服")
      .click(),
  );
  await wait(() => document.querySelectorAll(".anke-group-chip").length === 1);
  const saved = await call(() =>
    app.plugins.plugins["anke-writing"].data.collapsedGroups.slice(),
  );
  await open(role);
  assert.equal(await folded("常服"), true);
  assert.equal(await folded("设定"), false);
  assert.equal(await folded("演出服"), true);
  assert.equal(await folded("说明"), false);
  assert.equal(await folded("冬服"), true);
  await toggle("冬服");
  await toggle("设定");
  await call(() => app.plugins.plugins["anke-writing"].views()[0].render());
  assert.equal(
    await folded("冬服"),
    false,
    "A refresh keeps this visit’s outline state",
  );
  assert.equal(await folded("设定"), true);
  assert.deepEqual(
    await call(() => app.plugins.plugins["anke-writing"].data.collapsedGroups),
    saved,
  );
  await open(chapter);
  assert.equal(
    await call(() => document.querySelector(".anke-group-chip").dataset.group),
    saved.find((k) => k.startsWith(role + "#")),
  );
  await open(role);
  assert.equal(
    await folded("冬服"),
    true,
    "Returning to the character resets image groups",
  );
  assert.equal(
    await folded("设定"),
    false,
    "Returning expands note-only headings",
  );
  await open(chapter);
  // The folded chip can be dragged past an expanded sibling; nested notes travel with it.
  assert.equal(await drag("常服", "冬服", true), true);
  await wait(
    async (path) =>
      (await app.plugins.plugins["anke-writing"].library.read(
        app.vault.getFileByPath(path),
      )) === window.groupLayoutCheck.expected,
    role,
  );
  await wait(
    () =>
      [...document.querySelectorAll(".anke-variant-group")]
        .map((el) => el.querySelector(".anke-group-heading").textContent)
        .join("|") === "设定 / 演出服|冬服",
  );
  assert.deepEqual(
    await call(() => app.plugins.plugins["anke-writing"].data.collapsedGroups),
    saved,
  );
  // The visual order can be unchanged when the moved column is folded.
  // Await replacement DOM so the next gesture uses the updated source positions.
  await wait(() => !window.groupLayoutCheck.dragLabel.isConnected);
  const content = await call(
    (path) =>
      app.plugins.plugins["anke-writing"].library.read(
        app.vault.getFileByPath(path),
      ),
    role,
  );
  assert.equal(
    await drag("冬服", "设定 / 演出服", false),
    false,
    "Cross-parent moves are unavailable",
  );
  assert.equal(
    await call(
      (path) =>
        app.plugins.plugins["anke-writing"].library.read(
          app.vault.getFileByPath(path),
        ),
      role,
    ),
    content,
  );
  // Bring the folded group back before the first sibling without unfolding it.
  assert.equal(await drag("常服", "冬服", false), true);
  await wait(async (path) => {
    const text = await app.plugins.plugins["anke-writing"].library.read(
      app.vault.getFileByPath(path),
    );
    return text.indexOf("# 常服") < text.indexOf("# 冬服");
  }, role);
  // Reload persists writing folds but starts a fresh outline visit.
  await call(async () => {
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    await app.plugins.plugins["anke-writing"].openCharacters();
  });
  await wait(() => document.querySelectorAll(".anke-group-chip").length === 1);
  await open(role);
  assert.equal(await folded("常服"), true);
  assert.equal(await folded("设定"), false);
  // Exercise the actual export command without replacing the system clipboard.
  await open(chapter);
  await call(() => {
    const editor = window.groupLayoutCheck.leaf.view.editor;
    editor.setValue(
      "First\n\n---\n\n**Second**\n\n[dice]1d100[/dice]\n\n---\n\nThird",
    );
    editor.setCursor({ line: 4, ch: 4 });
    editor.focus();
    navigator.clipboard.writeText = async (text) => {
      window.groupLayoutCheck.copied = text;
    };
  });
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: "ç",
      code: "KeyC",
      modifiers: 1,
      windowsVirtualKeyCode: 67,
    });
  await wait(() => window.groupLayoutCheck.copied !== undefined);
  assert.equal(
    await call(() => window.groupLayoutCheck.copied),
    "[b]Second[/b]\n\n[dice]1d100[/dice]",
  );
  await call(() => {
    const editor = window.groupLayoutCheck.leaf.view.editor;
    editor.setSelection({ line: 4, ch: 2 }, { line: 4, ch: 8 });
    app.commands.executeCommandById("anke-writing:copy-nga-bbcode");
  });
  await wait(() => window.groupLayoutCheck.copied === "Second");
  console.log(
    "PASS: independent writing/outline folds, outline reset on return, persistent column folds, folded-chip subtree drag, cross-level restriction, and current-section/selection BBCode export",
  );
} finally {
  await call(async (root) => {
    const state = window.groupLayoutCheck;
    if (!state) return;
    navigator.clipboard.writeText = state.write;
    const p = app.plugins.plugins["anke-writing"];
    for (const leaf of app.workspace.getLeavesOfType("markdown"))
      if (leaf.view.file?.path.startsWith(root + "/")) leaf.detach();
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (key) => !key.startsWith(root + "/"),
    );
    await p.persist();
    if (state.active)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    p.views()[0].characterPath = state.character;
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0].render();
    delete window.groupLayoutCheck;
  }, root);
  c.close();
}
