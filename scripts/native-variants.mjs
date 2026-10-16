import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const waitFor = async (fn) => {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for variant UI");
};
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode:
        { Enter: 13, Escape: 27 }[code] ?? code.at(-1).charCodeAt(0),
      ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}),
    });
};
const root = `VariantCheck-${Date.now()}`;
const groupPath = `${root}/角色/Alpha/photo/常服.md`;
const query = async (text) => {
  await call((text) => {
    const input = document.querySelector(".prompt-input");
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await waitFor(() =>
    call(
      (text) =>
        document.querySelector(".prompt-input")?.value === text &&
        !document.querySelector(".prompt-results.is-loading"),
      text,
    ),
  );
  return call(() => ({
    scope: document.querySelector(".anke-search-scope").textContent,
    rows: [...document.querySelectorAll(".suggestion-item")].map(
      (el) => el.textContent,
    ),
  }));
};
try {
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    window.ankeVariantCheck = {
      root,
      active: app.workspace.activeLeaf,
      leaf: app.workspace.getLeaf("tab"),
      character: p.views()[0]?.characterPath,
      collapsed: [...p.data.collapsedGroups],
      pattern: p.data.chapterPattern,
    };
    await p.setChapterPattern("^\\d+-\\d+");
    await p.library.createProject(root);
    await p.library.createProject(root + "-other");
  }, root);
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((x) => x.root === root + "-other"),
      root,
    ),
  );
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root),
      other = p.library.projects().find((x) => x.root === root + "-other");
    for (const name of ["Alpha", "Beta", "Hidden"])
      await p.library.createCharacter(project, name);
    await p.library.createCharacter(other, "Beta");
    const portrait =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#abc"/></svg>';
    for (const [projectRoot, name] of [
      [root, "Alpha"],
      [root, "Beta"],
      [root, "Hidden"],
      [root + "-other", "Beta"],
    ])
      await app.vault.create(
        `${projectRoot}/角色/${name}/assets/test.svg`,
        portrait,
      );
    await app.vault.create(
      `${root}/角色/Alpha/assets/wide.svg`,
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#cba"/></svg>',
    );
    const list = (labels, url = "../assets/test.svg") =>
      "---\nanke-type: variants\n---\n\n" +
      labels.map((s) => `- [${s}](${url})`).join("\n");
    for (const [name, labels] of [
      [
        "春季校服",
        ["共用微笑", ...Array.from({ length: 40 }, (_, i) => `春季表情${i}`)],
      ],
      ["常服", ["共用微笑", "隐藏微笑"]],
      ["夏季校服", ["夏季微笑"]],
      ["秋季校服", Array.from({ length: 40 }, (_, i) => `秋季表情${i}`)],
      ["冬季校服", ["冬季微笑"]],
    ])
      await app.vault.create(
        `${root}/角色/Alpha/photo/${name}.md`,
        list(labels),
      );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/角色/Alpha/photo/默认.md`),
      list(["横幅"], "../assets/wide.svg"),
    );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/角色/Beta/photo/默认.md`),
      list(["隐藏微笑", "作品专用"]),
    );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/角色/Hidden/photo/默认.md`),
      list(["隐藏角色专用"]),
    );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}-other/角色/Beta/photo/默认.md`),
      list(["外项目专用"]),
    );
    await p.library.setVisible(project, [
      `${root}/角色/Alpha/Alpha.md`,
      `${root}/角色/Beta/Beta.md`,
    ]);
    p.data.collapsedGroups.push(
      `${root}/角色/Alpha/photo/常服.md`,
      `${root}/角色/Alpha/photo/夏季校服.md`,
    );
    await p.persist();
    const leaf = window.ankeVariantCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: `${root}/1-1 第一章.md`, mode: "source" },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.setValue("BeforeAfter");
    leaf.view.editor.setCursor({ line: 0, ch: 6 });
    leaf.view.editor.focus();
  }, root);
  await waitFor(() =>
    call(() => document.querySelectorAll(".anke-variant-group").length === 4),
  );
  const columns = await call(() => {
    const panel = app.plugins.plugins["anke-writing"].views()[0].contentEl;
    return {
      chips: [...panel.querySelectorAll(".anke-chip-short")].map(
        (e) => e.textContent,
      ),
      headings: [
        ...panel.querySelectorAll(".anke-variant-group .anke-group-heading"),
      ].map((e) => e.textContent),
      overflow:
        panel.querySelector(".anke-variant-columns").scrollWidth >
        panel.querySelector(".anke-variant-columns").clientWidth,
    };
  });
  assert.deepEqual(columns.chips.sort(), ["常", "夏"].sort());
  assert.equal(columns.headings.length, 4);
  assert.equal(columns.overflow, true);
  await call(() => {
    const panel = app.plugins.plugins["anke-writing"].views()[0].contentEl;
    const find = (name) =>
      [...panel.querySelectorAll(".anke-variant-group")]
        .find((e) => e.dataset.path.endsWith(name + ".md"))
        .querySelector(".anke-variant-grid");
    find("春季校服").scrollTop = 200;
    find("秋季校服").scrollTop = 70;
    panel.querySelector(".anke-variant-columns").scrollLeft = 80;
  });
  const positions = () =>
    call(() => {
      const panel = app.plugins.plugins["anke-writing"].views()[0].contentEl;
      const find = (name) =>
        [...panel.querySelectorAll(".anke-variant-group")]
          .find((e) => e.dataset.path.endsWith(name + ".md"))
          .querySelector(".anke-variant-grid").scrollTop;
      return [
        find("春季校服"),
        find("秋季校服"),
        panel.querySelector(".anke-variant-columns").scrollLeft,
      ];
    });
  assert.deepEqual(await positions(), [200, 70, 80]);
  await call(async () => {
    await app.plugins.plugins["anke-writing"].views()[0].render();
  });
  assert.deepEqual(await positions(), [200, 70, 80]);
  for (const expanded of [true, false]) {
    await call(
      (path) =>
        [...document.querySelectorAll(".anke-group-heading")]
          .find((el) => el.title === path)
          .click(),
      groupPath,
    );
    await waitFor(() =>
      call(
        (path, expanded) =>
          [...document.querySelectorAll(".anke-group-heading")]
            .find((el) => el.title === path)
            ?.getAttribute("aria-expanded") === String(expanded),
        groupPath,
        expanded,
      ),
    );
    assert.equal(
      await call(
        async (path) =>
          (
            await app.plugins.plugins["anke-writing"].loadData()
          ).collapsedGroups.includes(path),
        groupPath,
      ),
      !expanded,
    );
  }
  const chip = await call(() => {
    const el = document.querySelector(".anke-group-chip"),
      r = el.getBoundingClientRect();
    return {
      x: r.left + 5,
      y: r.top + 5,
      width: r.width,
      full: getComputedStyle(el.querySelector(".anke-chip-full")).display,
    };
  });
  assert.equal(chip.full, "none");
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: chip.x,
    y: chip.y,
  });
  assert.equal(
    await call(
      () => getComputedStyle(document.querySelector(".anke-chip-full")).display,
    ),
    "inline",
  );
  assert.ok(
    await call(
      (width) =>
        document.querySelector(".anke-group-chip").getBoundingClientRect()
          .width > width,
      chip.width,
    ),
  );
  await c.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 600,
    y: 200,
  });
  console.log(
    "PASS: file columns scroll horizontally and vertically independently; scroll offsets survive refresh; collapsed chips expand their names on hover",
  );

  for (const [name, expected] of [
    ["春季校服", [140, 210]],
    ["默认", [180, 60]],
  ]) {
    await call((name) => {
      const column = [...document.querySelectorAll(".anke-variant-group")].find(
        (e) => e.dataset.path.endsWith(name + ".md"),
      );
      column
        .querySelector(".anke-thumbnail")
        .dispatchEvent(new MouseEvent("mouseenter"));
    }, name);
    await waitFor(() =>
      call(
        () =>
          document.querySelector(".anke-hover-preview")?.style.visibility ===
          "visible",
      ),
    );
    const size = await call(() => {
      const img = document.querySelector(".anke-hover-preview img");
      return [img.width, img.height];
    });
    assert.deepEqual(size, expected);
    await call(() =>
      app.plugins.plugins["anke-writing"].views()[0].hidePreview(),
    );
  }
  console.log(
    "PASS: portrait and landscape previews are half-size and preserve the original aspect ratios",
  );

  await call(() => window.ankeVariantCheck.leaf.view.editor.focus());
  await key("P", "KeyP", 12);
  await waitFor(() =>
    call(() => !!document.querySelector(".anke-search-scope")),
  );
  let result = await query("共用微笑");
  assert.ok(result.scope.startsWith("当前角色 · 已展开文件"));
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].includes("Alpha / 春季校服"));
  result = await query("隐藏微笑");
  assert.ok(result.scope.startsWith("当前角色 · 全部差分"));
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].includes("Alpha / 常服"));
  result = await query("隐藏角色专用");
  assert.ok(result.scope.startsWith("当前作品 · 全部角色"));
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].includes("Hidden / 默认"));
  result = await query("外项目专用");
  assert.equal(result.rows.length, 0);
  result = await query("Alpha");
  assert.equal(
    result.rows.length,
    0,
    "Only descriptions are searched, not character names",
  );
  result = await query("共用微笑");
  assert.ok(
    result.scope.startsWith("当前角色 · 已展开文件"),
    "Scope must narrow again for each new query",
  );
  result = await query("作品专用");
  assert.equal(result.rows.length, 1);
  await key("Enter", "Enter");
  await waitFor(() => call(() => !document.querySelector(".prompt")));
  const inserted = await call(() =>
    window.ankeVariantCheck.leaf.view.editor.getValue(),
  );
  assert.equal(inserted, "Before![作品专用](<角色/Beta/assets/test.svg>)After");
  await key("z", "KeyZ", 4);
  assert.equal(
    await call(() => window.ankeVariantCheck.leaf.view.editor.getValue()),
    "BeforeAfter",
  );
  await key("P", "KeyP", 12);
  await waitFor(() =>
    call(() => !!document.querySelector(".anke-search-scope")),
  );
  await key("Escape", "Escape");
  assert.equal(
    await call(() => window.ankeVariantCheck.leaf.view.editor.getValue()),
    "BeforeAfter",
  );
  console.log(
    "PASS: Cmd+Shift+P opens search; scope widens only on zero matches, includes hidden project roles, excludes other projects; insertion preserves the caret position and undoes normally",
  );

  const openDelete = () =>
    call(() => {
      const card = [...document.querySelectorAll(".anke-character")].find(
        (el) => el.title === "Beta",
      );
      card.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      [...document.querySelectorAll(".menu-item")]
        .find((el) => el.textContent.includes("删除角色"))
        .click();
    });
  await openDelete();
  assert.ok(
    await call(() =>
      document.querySelector(".modal-title").textContent.includes("Beta"),
    ),
  );
  await call(() =>
    [...document.querySelectorAll(".modal button")]
      .find((el) => el.textContent === "取消")
      .click(),
  );
  assert.equal(
    await call(
      (root) => !!app.vault.getFolderByPath(`${root}/角色/Beta`),
      root,
    ),
    true,
  );
  const trashBefore = await call(
    async () => (await app.vault.adapter.list(".trash")).folders,
  );
  await openDelete();
  await call(() =>
    [...document.querySelectorAll(".modal button")]
      .find((el) => el.textContent === "移入垃圾箱")
      .click(),
  );
  await waitFor(() =>
    call(
      (root) =>
        !app.vault.getFolderByPath(`${root}/角色/Beta`) &&
        !document.querySelector(".modal"),
      root,
    ),
  );
  await waitFor(() =>
    call((root) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root);
      return project.characters.length === 1;
    }, root),
  );
  assert.equal(
    await call(
      (root) => !!app.vault.getFileByPath(`${root}-other/角色/Beta/Beta.md`),
      root,
    ),
    true,
  );
  assert.equal(
    await call(async (before) => {
      const added = (await app.vault.adapter.list(".trash")).folders.filter(
        (p) => !before.includes(p),
      );
      for (const folder of added)
        if (
          (await app.vault.adapter.exists(`${folder}/Beta.md`)) &&
          (await app.vault.adapter.exists(`${folder}/assets/test.svg`))
        )
          return true;
      return false;
    }, trashBefore),
    true,
  );
  console.log(
    "PASS: character context-menu deletion supports cancel, removes only the chosen project copy and visibility reference, and retains the note and images in the vault trash",
  );
} finally {
  await call(async () => {
    const state = window.ankeVariantCheck;
    if (!state) return;
    const p = app.plugins.plugins["anke-writing"];
    document.querySelector(".modal-close-button")?.click();
    state.leaf.detach();
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (path) =>
        ![state.root, state.root + "-other"].some((root) =>
          path.startsWith(root + "/"),
        ),
    );
    await p.setChapterPattern(state.pattern);
    for (const root of [state.root, state.root + "-other"]) {
      const folder = app.vault.getFolderByPath(root);
      if (folder) await app.vault.trash(folder, false);
    }
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    if (p.views()[0]) p.views()[0].characterPath = state.character || "";
    p.refresh();
    delete window.ankeVariantCheck;
  });
  c.close();
}
