import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = async (fn, ...args) => {
  for (let i = 0; i < 100; i++) {
    if (await call(fn, ...args)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Search/color condition timed out: " + fn);
};
const key = async (key, code, keyCode, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
    });
};
const root = `SearchColorCheck-${Date.now()}`;
const query = async (text) => {
  await call((text) => {
    const input = document.querySelector(".anke-variant-search input");
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await wait(
    () =>
      !document.querySelector(
        ".anke-variant-search .prompt-results.is-loading",
      ),
  );
  return call(() => ({
    scope: document.querySelector(".anke-search-scope").textContent,
    rows: [
      ...document.querySelectorAll(".anke-variant-search .suggestion-item"),
    ].map((el) => el.textContent),
  }));
};
try {
  if (await call(() => !!document.querySelector(".anke-variant-search")))
    await key("Escape", "Escape", 27);
  await c.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await call(async (root) => {
    if (document.querySelector(".modal,.prompt"))
      throw Error("Close dialogs before testing");
    const p = app.plugins.plugins["anke-writing"],
      active = app.workspace.activeLeaf;
    await p.openCharacters();
    window.searchColorsCheck = {
      active,
      character: p.views()[0]?.characterPath,
      leaf: app.workspace.getLeaf("tab"),
      write: navigator.clipboard.writeText,
    };
    await p.library.createProject(root);
    await app.vault.create(
      root + "/portrait.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300"><rect width="100" height="300" fill="#76a893"/><circle cx="50" cy="50" r="30" fill="#f8e7d0"/><rect x="20" y="90" width="60" height="130" rx="15" fill="#4b6179"/></svg>',
    );
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((p) => p.root === root),
    root,
  );
  const role = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((p) => p.root === root);
    const file = await p.library.createCharacter(project, "若叶睦");
    if (!(await app.vault.read(file)).includes('color: "red"'))
      throw Error("New character must use an NGA color name");
    await app.vault.modify(
      file,
      '---\nanke-type: character\nname: 若叶睦\ncolor: "#6b9e83"\n---\n\n# 冬季校服\n- [站姿](../portrait.svg)\n\n# 夏季校服\n- [微笑](../portrait.svg)\n- [平静](../portrait.svg)\n\n# 夏日笔记\nKeep notes.\n',
    );
    const other = await p.library.createCharacter(project, "丰川祥子");
    await app.vault.modify(
      other,
      "---\nanke-type: character\nname: 丰川祥子\ncolor: red\n---\n\n# 常服\n- [好奇](../portrait.svg)\n",
    );
    return file.path;
  }, root);
  await wait(
    (root) => {
      const library = app.plugins.plugins["anke-writing"].library;
      const project = library.projects().find((p) => p.root === root);
      return !!project && library.characters(project).length === 2;
    },
    root,
  );
  await call(
    async (root, role) => {
      const p = app.plugins.plugins["anke-writing"];
      const character = p.library
        .characters(p.library.projects().find((p) => p.root === root))
        .find((c) => c.file.path === role);
      const group = (await p.library.groups(character)).find(
        (g) => g.title === "夏季校服",
      );
      p.data.collapsedGroups.push(group.key);
      const leaf = window.searchColorsCheck.leaf;
      await leaf.setViewState({
        type: "markdown",
        state: { file: root + "/1-1 第一章.md", mode: "source", source: true },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      p.views()[0].select(character);
      await p.views()[0].render();
      leaf.view.editor.focus();
    },
    root,
    role,
  );
  await wait(
    (role) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
      role,
    role,
  );
  await call(() =>
    app.commands.executeCommandById("anke-writing:search-variants"),
  );
  await wait(
    () => !!document.querySelector(".anke-variant-search .suggestion-item"),
  );
  const summer = await query("夏");
  assert.equal(summer.rows.length, 2);
  assert.ok(summer.rows.every((row) => row.includes("夏季校服")));
  assert.ok(summer.scope.startsWith("当前角色 · 全部差分"));
  for (const terms of ["若叶睦 夏 微笑", "微笑 夏 睦"]) {
    const result = await query(terms);
    assert.equal(result.rows.length, 1);
    assert.ok(result.rows[0].startsWith("微笑"));
  }
  assert.equal((await query("睦 冬 微笑")).rows.length, 0);
  const other = await query("祥子");
  assert.equal(other.rows.length, 1);
  assert.ok(other.rows[0].includes("丰川祥子"));
  assert.ok(other.scope.startsWith("当前作品 · 全部角色"));
  await query("夏");
  await wait(
    () => document.querySelector(".anke-search-preview img")?.naturalWidth > 0,
  );
  const geometry = await call(() => {
    const preview = document
      .querySelector(".anke-search-preview")
      .getBoundingClientRect();
    const results = document
      .querySelector(".anke-variant-search .prompt-results")
      .getBoundingClientRect();
    return { previewRight: preview.right, resultsLeft: results.left };
  });
  assert.ok(geometry.previewRight <= geometry.resultsLeft + 1);
  await c.screenshot("/tmp/anke-search-left.png");
  await key("ArrowDown", "ArrowDown", 40);
  await wait(
    () => document.querySelector(".anke-search-preview img")?.alt === "平静",
  );
  await key("Escape", "Escape", 27);
  await call(() => document.querySelector(".anke-color-button").click());
  await wait(() => !!document.querySelector(".anke-color-grid"));
  assert.equal(
    await call(
      () => document.querySelectorAll(".anke-color-grid button").length,
    ),
    24,
  );
  assert.equal(
    await call(
      () => !!document.querySelector(".anke-color-modal input[type=color]"),
    ),
    false,
  );
  await c.screenshot("/tmp/anke-color-palette.png");
  await call(() =>
    document.querySelector('.anke-color-grid button[title="skyblue"]').click(),
  );
  await wait(
    (role) =>
      app.metadataCache.getFileCache(app.vault.getFileByPath(role))?.frontmatter
        ?.color === "skyblue",
    role,
  );
  await wait(() => !document.querySelector(".anke-color-modal"));
  for (const source of [true, false]) {
    await call(async (source) => {
      const leaf = window.searchColorsCheck.leaf;
      await leaf.setViewState({
        type: "markdown",
        state: { file: leaf.view.file.path, mode: "source", source },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      leaf.view.editor.setValue("“测试”\n“第二行”");
      leaf.view.editor.setCursor({ line: 0, ch: 2 });
      leaf.view.editor.focus();
    }, source);
    const value = () =>
      call(() => window.searchColorsCheck.leaf.view.editor.getValue());
    const plain = "“测试”\n“第二行”";
    const blue = "“[color=skyblue]测试[/color]”\n“第二行”";
    await key("1", "Digit1", 49, 1);
    assert.equal(await value(), blue);
    await key("1", "Digit1", 49, 1);
    assert.equal(
      await value(),
      plain,
      "The same shortcut clears the current line",
    );
    await key("z", "KeyZ", 90, 4);
    assert.equal(await value(), blue, "Undo restores the removed color");
    await key("Z", "KeyZ", 90, 12);
    assert.equal(await value(), plain, "Redo removes the color again");
    await key("1", "Digit1", 49, 1);
    await key("2", "Digit2", 50, 1);
    assert.equal(await value(), "“[color=red]测试[/color]”\n“第二行”");
    await key("2", "Digit2", 50, 1);
    assert.equal(await value(), plain);
    await call(() =>
      window.searchColorsCheck.leaf.view.editor.setSelection(
        { line: 0, ch: 0 },
        { line: 1, ch: 5 },
      ),
    );
    await key("1", "Digit1", 49, 1);
    assert.equal(
      await value(),
      "“[color=skyblue]测试[/color]”\n“[color=skyblue]第二行[/color]”",
    );
    await key("1", "Digit1", 49, 1);
    assert.equal(
      await value(),
      plain,
      "Selected lines clear together without reselecting",
    );
    await wait(
      (role) =>
        app.plugins.plugins["anke-writing"].views()[0].characterPath === role,
      role,
    );
    console.log(
      `PASS (${source ? "source" : "live preview"}): Alt+1/2 color toggle, recoloring, selected lines, undo/redo, sidebar selection.`,
    );
  }
  const old = "“[color=#87ceeb]旧文[/color]”";
  await call((old) => {
    const leaf = window.searchColorsCheck.leaf;
    leaf.view.editor.setValue(old);
    leaf.view.editor.setCursor({ line: 0, ch: 2 });
    leaf.view.editor.focus();
    navigator.clipboard.writeText = async (text) => {
      window.searchColorsCheck.copied = text;
    };
    app.commands.executeCommandById("anke-writing:copy-nga-bbcode");
  }, old);
  await wait(() => window.searchColorsCheck.copied !== undefined);
  assert.equal(
    await call(() => window.searchColorsCheck.copied),
    "“[color=skyblue]旧文[/color]”",
  );
  assert.equal(
    await call(() => window.searchColorsCheck.leaf.view.editor.getValue()),
    old,
  );
  console.log(
    "PASS: group/character/description and compound queries, collapsed-group and character scope widening, left preview and keyboard updates, 24-color palette saves a name, color command and undo, legacy RGB copy without rewriting the source",
  );
} finally {
  await key("Escape", "Escape", 27);
  await call(async (root) => {
    const state = window.searchColorsCheck;
    if (!state) return;
    navigator.clipboard.writeText = state.write;
    if (state.leaf.view.save) await state.leaf.view.save();
    await state.leaf.setViewState({ type: "empty", state: {} });
    state.leaf.detach();
    const p = app.plugins.plugins["anke-writing"];
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (key) => !key.startsWith(root + "/"),
    );
    for (const path of Object.keys(p.data.variantUsage))
      if (path.startsWith(root + "/")) delete p.data.variantUsage[path];
    await p.persist();
    if (state.active)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    if (p.views()[0]) p.views()[0].characterPath = state.character;
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0]?.render();
    delete window.searchColorsCheck;
  }, root);
  c.close();
}
