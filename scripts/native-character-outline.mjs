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
  throw Error("Outline condition timed out");
};
const key = async (key, code) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: { Enter: 13, Escape: 27 }[code],
    });
};
const root = `OutlineCheck-${Date.now()}`;
let alpha, beta;
// Clear a pending IME preedit before opening disposable test notes.
await c.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
try {
  await call(async (root) => {
    if (document.querySelector(".modal"))
      throw Error("Close dialogs before running this check");
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    const p = app.plugins.plugins["anke-writing"];
    await p.openCharacters();
    window.outlineCheck = {
      active: app.workspace.activeLeaf,
      character: p.views()[0].characterPath,
      leaf: app.workspace.getLeaf("tab"),
    };
    await p.library.createProject(root);
    await app.vault.create(
      root + "/portrait.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#b8d3bf"/></svg>',
    );
    await app.vault.create(root + "/参考.md", "# Reference\n");
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((p) => p.root === root),
    root,
  );
  [alpha, beta] = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    const a = await p.library.createCharacter(project, "Alpha"),
      b = await p.library.createCharacter(project, "Beta");
    await app.vault.modify(
      a,
      "---\nanke-type: character\nname: Alpha\n---\n\n# Alpha only\n- [A](../portrait.svg)",
    );
    const text =
      "---\nanke-type: character\nname: Beta\n---\n\n# 人物笔记\nKeep this note.\n\n## 人际关系\n- [参考文章](https://example.invalid/story)\n- [本地资料](../参考.md)\n\n# 常服\n- [微笑](../portrait.svg)\n- [保留说明](https://example.invalid/reference)\n- [哭泣](../portrait.svg)\n\n# 演出服\n## 站姿\n![[portrait.svg|站姿]]\n\n# 空组\n";
    await app.vault.modify(b, text);
    window.outlineCheck.betaText = text;
    await window.outlineCheck.leaf.openFile(
      app.vault.getFileByPath(root + "/1-1 第一章.md"),
    );
    app.workspace.setActiveLeaf(window.outlineCheck.leaf, { focus: true });
    p.views()[0].characterPath = a.path;
    return [a.path, b.path];
  }, root);
  await wait(
    (path) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
      path,
    alpha,
  );
  await call(async (path) => {
    const leaf = window.outlineCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: true },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, beta);
  await wait(
    (path) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        path && !!document.querySelector(".anke-outline"),
    beta,
  );
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".anke-outline-heading")].map(
        (el) => el.textContent,
      ),
    ),
    ["人物笔记", "人际关系", "常服", "演出服", "站姿", "空组"],
  );
  assert.equal(
    await call(
      () =>
        document.querySelectorAll(".anke-outline-row > .anke-add-variant")
          .length,
    ),
    6,
  );
  assert.equal(
    await call(
      () => document.querySelectorAll(".anke-outline .anke-thumbnail").length,
    ),
    3,
    "Notes are not image variants",
  );
  assert.ok(
    await call(() =>
      [...document.querySelectorAll(".anke-outline-heading")]
        .find((el) => el.textContent === "人际关系")
        .closest("ul")
        .classList.contains("anke-outline-children"),
    ),
  );
  // Opening a hidden character is inspection, not a change to project visibility.
  await call(
    async (root, path) => {
      const p = app.plugins.plugins["anke-writing"];
      await p.library.setVisible(
        p.library.projects().find((x) => x.root === root),
        [path],
      );
    },
    root,
    alpha,
  );
  await wait((root) => {
    const p = app.plugins.plugins["anke-writing"];
    return (
      p.library.projects().find((x) => x.root === root)?.characters.length === 1
    );
  }, root);
  await call(() => app.plugins.plugins["anke-writing"].views()[0].render());
  assert.equal(
    await call(
      () => document.querySelector(".anke-variant-browser").dataset.character,
    ),
    beta,
  );
  // Clicking a title reuses the note tab and positions the cursor at that heading.
  const tabs = await call(
    () => app.workspace.getLeavesOfType("markdown").length,
  );
  await call(() =>
    [...document.querySelectorAll(".anke-outline-heading")]
      .find((el) => el.textContent === "人际关系")
      .click(),
  );
  await wait(
    () =>
      window.outlineCheck.leaf.view.editor.getLine(
        window.outlineCheck.leaf.view.editor.getCursor().line,
      ) === "## 人际关系",
  );
  assert.equal(
    await call(() => app.workspace.getLeavesOfType("markdown").length),
    tabs,
  );
  assert.equal(
    await call(() => window.outlineCheck.leaf.view.editor.getValue()),
    await call(() => window.outlineCheck.betaText),
  );
  // An empty heading's add button must append to that heading, before the next sibling.
  await call(() =>
    [...document.querySelectorAll(".anke-outline-heading")]
      .find((el) => el.textContent === "人际关系")
      .parentElement.querySelector(".anke-add-variant")
      .click(),
  );
  await call(() => {
    const [label, url] = document.querySelectorAll(".modal input");
    label.value = "关系图";
    url.value = "../portrait.svg";
    for (const i of [label, url])
      i.dispatchEvent(new Event("input", { bubbles: true }));
    url.focus();
  });
  await key("Enter", "Enter");
  await wait(() => !document.querySelector(".modal"));
  await wait(
    () =>
      document.querySelectorAll(".anke-outline .anke-thumbnail").length === 4,
  );
  const changed = await call(() =>
    window.outlineCheck.leaf.view.editor.getValue(),
  );
  assert.ok(
    changed.indexOf("关系图") > changed.indexOf("## 人际关系") &&
      changed.indexOf("关系图") < changed.indexOf("# 常服"),
  );
  assert.ok(
    changed.includes(
      "- [参考文章](https://example.invalid/story)\n- [本地资料](../参考.md)",
    ),
  );
  // Disclosures fold children, while the title remains a jump target.
  await call(() =>
    [...document.querySelectorAll(".anke-outline-heading")]
      .find((el) => el.textContent === "演出服")
      .parentElement.querySelector(".anke-outline-toggle")
      .click(),
  );
  assert.equal(
    await call(
      () =>
        [...document.querySelectorAll(".anke-outline-heading")]
          .find((el) => el.textContent === "演出服")
          .closest("li")
          .querySelector(".anke-outline-content").hidden,
    ),
    true,
  );
  await call(() =>
    [...document.querySelectorAll(".anke-outline-heading")]
      .find((el) => el.textContent === "演出服")
      .parentElement.querySelector(".anke-outline-toggle")
      .click(),
  );
  await c.screenshot("/tmp/anke-character-outline.png");
  // Re-enter writing mode: only image-bearing groups remain.
  await call(
    async (root, a, b) => {
      const p = app.plugins.plugins["anke-writing"];
      await p.library.setVisible(
        p.library.projects().find((x) => x.root === root),
        [a, b],
      );
      await window.outlineCheck.leaf.openFile(
        app.vault.getFileByPath(root + "/1-1 第一章.md"),
      );
      app.workspace.setActiveLeaf(window.outlineCheck.leaf, { focus: true });
      p.views()[0].characterPath = b;
    },
    root,
    alpha,
    beta,
  );
  await wait(
    () =>
      document.querySelectorAll(".anke-group-heading").length === 3 &&
      !document.querySelector(".anke-outline"),
  );
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".anke-group-heading")].map(
        (el) => el.textContent,
      ),
    ),
    ["人物笔记 / 人际关系", "常服", "演出服 / 站姿"],
  );
  // Drag image rows around a note link; the note itself must stay unchanged.
  await call(() => {
    const column = [...document.querySelectorAll(".anke-variant-group")].find(
      (el) => el.querySelector(".anke-group-heading").textContent === "常服",
    );
    const rows = column.querySelectorAll(".anke-variant");
    const dt = new DataTransfer();
    rows[0]
      .querySelector(".anke-thumbnail")
      .dispatchEvent(
        new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
      );
    rows[1].dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await wait(
    async (path) =>
      (
        await app.plugins.plugins["anke-writing"].library.read(
          app.vault.getFileByPath(path),
        )
      ).includes(
        "- [哭泣](../portrait.svg)\n- [保留说明](https://example.invalid/reference)\n- [微笑](../portrait.svg)",
      ),
    beta,
  );
  // Reading preview renders image links, while reference links remain ordinary anchors.
  await call(async (path) => {
    await window.outlineCheck.leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "preview" },
      active: true,
    });
    app.workspace.setActiveLeaf(window.outlineCheck.leaf, { focus: true });
  }, beta);
  await wait(
    () =>
      window.outlineCheck.leaf.view.containerEl.querySelectorAll(
        ".anke-reading-image",
      ).length >= 2,
  );
  assert.equal(
    await call(
      () =>
        [
          ...window.outlineCheck.leaf.view.containerEl.querySelectorAll("a"),
        ].filter((a) =>
          ["参考文章", "本地资料", "保留说明"].includes(a.textContent),
        ).length,
    ),
    3,
  );
  assert.equal(
    await call(
      () =>
        window.outlineCheck.leaf.view.containerEl.querySelectorAll(
          'a[href*="example.invalid"] img',
        ).length,
    ),
    0,
  );
  // Choosing another character while editing a character opens that file, rather than fighting focus-following.
  await call(async (path) => {
    await window.outlineCheck.leaf.openFile(app.vault.getFileByPath(path));
    app.workspace.setActiveLeaf(window.outlineCheck.leaf, { focus: true });
  }, beta);
  await wait(() => !!document.querySelector(".anke-outline"));
  await call(() =>
    [...document.querySelectorAll(".anke-character")]
      .find((el) => el.title === "Alpha")
      .click(),
  );
  await wait(
    (path) =>
      app.workspace.getActiveFile()?.path === path &&
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        path,
    alpha,
  );
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".anke-outline-heading")].map(
        (el) => el.textContent,
      ),
    ),
    ["Alpha only"],
  );
  console.log(
    "PASS: focused character selection (including hidden roles), full nested headings and thumbnails, same-tab heading navigation, empty-heading addition, image-only writing groups, note-safe drag sorting / reading preview, and character switching",
  );
} finally {
  await key("Escape", "Escape");
  await call(async (root) => {
    const state = window.outlineCheck;
    if (!state) return;
    const p = app.plugins.plugins["anke-writing"];
    for (const leaf of app.workspace.getLeavesOfType("markdown"))
      if (leaf.view.file?.path.startsWith(root + "/")) leaf.detach();
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (path) => !path.startsWith(root + "/"),
    );
    await p.persist();
    if (state.active)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    p.views()[0].characterPath = state.character;
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0].render();
    delete window.outlineCheck;
  }, root);
  c.close();
}
