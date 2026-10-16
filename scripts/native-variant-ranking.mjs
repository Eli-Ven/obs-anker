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
  throw Error("Ranking condition timed out: " + fn);
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
const root = `RankingCheck-${Date.now()}`;
let role;
const original = ["A", "B", "C", "D", "E", "F", "G", "H"];
const mainOrder = () =>
  call(() =>
    [
      ...[...document.querySelectorAll(".anke-variant-group")]
        .find(
          (el) =>
            el.querySelector(".anke-group-heading")?.textContent === "Main",
        )
        .querySelectorAll(".anke-variant input"),
    ].map((el) => el.value),
  );
const searchRows = () =>
  call(() =>
    [...document.querySelectorAll(".anke-variant-search .suggestion-item")].map(
      (el) => el.firstElementChild.textContent,
    ),
  );
const query = async (text) => {
  await call((text) => {
    const el = document.querySelector(".anke-variant-search input");
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await wait(
    () =>
      !document.querySelector(
        ".anke-variant-search .prompt-results.is-loading",
      ),
  );
};
const open = async (path) => {
  await call(async (path) => {
    const leaf = window.rankingCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: true },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.focus();
    await app.plugins.plugins["anke-writing"].views()[0].render();
  }, path);
  await wait((path) => app.workspace.getActiveFile()?.path === path, path);
};
const select = async (name) => {
  await call(
    (name) =>
      [...document.querySelectorAll(".anke-character")]
        .find((el) => el.title === name)
        .click(),
    name,
  );
  await wait(
    (name) =>
      document.querySelector(".anke-character.is-selected")?.title === name,
    name,
  );
  await call(() => app.plugins.plugins["anke-writing"].views()[0].render());
};
const click = async (label) => {
  await call(
    (label) =>
      [...document.querySelectorAll(".anke-variant")]
        .find((el) => el.querySelector("input")?.value === label)
        .querySelector("button")
        .click(),
    label,
  );
  await call(() => app.plugins.plugins["anke-writing"].views()[0].render());
};
const usage = () =>
  call(
    (role) => app.plugins.plugins["anke-writing"].data.variantUsage[role] ?? {},
    role,
  );
const search = async () => {
  await call(() => {
    window.rankingCheck.leaf.view.editor.focus();
    app.commands.executeCommandById("anke-writing:search-variants");
  });
  await wait(
    () => !!document.querySelector(".anke-variant-search .suggestion-item"),
  );
};
try {
  // Cancels only the existing search popup, without editing its target document.
  if (await call(() => !!document.querySelector(".anke-variant-search")))
    await key("Escape", "Escape", 27);
  await c.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await call(async (root) => {
    if (document.querySelector(".modal,.prompt"))
      throw Error("Close other dialogs before testing");
    const p = app.plugins.plugins["anke-writing"];
    const active = app.workspace.activeLeaf;
    await p.openCharacters();
    window.rankingCheck = {
      active,
      character: p.views()[0]?.characterPath,
      leaf: app.workspace.getLeaf("tab"),
    };
    await p.library.createProject(root);
    for (const name of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
      await app.vault.create(
        root + "/" + name + ".svg",
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="80"><rect width="40" height="80" fill="#76a893"/></svg>',
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
    const file = await p.library.createCharacter(project, "Alpha");
    const text =
      "---\nanke-type: character\nname: Alpha\n---\n\n# Main\n" +
      ["A", "B", "C", "D", "E", "F", "G", "H"]
        .map((name) => `- [${name}](../${name}.svg)`)
        .join("\n") +
      "\n\nKeep these notes.\n\n# Search\n- [smile slowly](../I.svg)\n- [smile](../J.svg)\n";
    window.rankingCheck.original = text;
    await app.vault.modify(file, text);
    const other = await p.library.createCharacter(project, "Other");
    await app.vault.modify(
      other,
      "---\nanke-type: character\nname: Other\n---\n\n# Main\n- [A](../A.svg)\n- [F](../F.svg)\n",
    );
    return file.path;
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library.characters(
        app.plugins.plugins["anke-writing"].library
          .projects()
          .find((p) => p.root === root),
      ).length === 2,
    root,
  );
  await open(root + "/1-1 第一章.md");
  await select("Alpha");
  assert.deepEqual(await mainOrder(), original);
  for (let i = 0; i < 7; i++) await click("F");
  assert.equal((await usage())["../F.svg"].count, 7);
  assert.deepEqual(
    await mainOrder(),
    original,
    "Repeated inserts and refreshes must not move the current sidebar",
  );
  assert.equal(
    await call((role) => app.vault.read(app.vault.getFileByPath(role)), role),
    await call(() => window.rankingCheck.original),
  );
  await select("Other");
  assert.deepEqual(await mainOrder(), ["A", "F"]);
  await select("Alpha");
  const ranked = ["A", "B", "F", "C", "D", "E", "G", "H"];
  assert.deepEqual(await mainOrder(), ranked);
  await open(role);
  const outline = await call(() =>
    [
      ...document
        .querySelector(".anke-outline-node")
        .querySelectorAll(".anke-variant input"),
    ].map((el) => el.value),
  );
  assert.deepEqual(
    outline,
    original,
    "Character outline must retain Markdown order",
  );
  await open(root + "/1-1 第一章.md");
  assert.deepEqual(await mainOrder(), ranked);
  await search();
  assert.deepEqual((await searchRows()).slice(0, 8), ranked);
  await key("ArrowDown", "ArrowDown", 40);
  assert.equal((await usage())["../F.svg"].count, 7);
  await query("F");
  assert.deepEqual(await searchRows(), ["F"]);
  await key("Enter", "Enter", 13);
  await wait(() => !document.querySelector(".anke-variant-search"));
  assert.equal((await usage())["../F.svg"].count, 8);
  for (let i = 0; i < 3; i++) await click("smile slowly");
  await search();
  await query("smile");
  assert.equal(
    (await searchRows())[0],
    "smile",
    "Exact text match must outrank a popular partial match",
  );
  await key("Escape", "Escape", 27);
  await call(() => {
    const row = [...document.querySelectorAll(".anke-variant")].find(
      (el) => el.querySelector("input")?.value === "G",
    );
    const dt = new DataTransfer();
    row
      .querySelector("button")
      .dispatchEvent(
        new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
      );
    const view = window.rankingCheck.leaf.view;
    view.editor.setCursor({ line: 0, ch: 0 });
    view.editor.focus();
    const editor = view.containerEl.querySelector(".cm-content"),
      r = editor.getBoundingClientRect();
    editor.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: r.left + 8,
        clientY: r.top + 8,
      }),
    );
  });
  assert.equal(
    (await usage())["../G.svg"].count,
    1,
    "Dropping into the editor counts once",
  );
  await call(() => app.plugins.plugins["anke-writing"].views()[0].render());
  assert.deepEqual(await mainOrder(), ranked);
  await call(() => {
    const rows = [...document.querySelectorAll(".anke-variant")];
    const source = rows.find((el) => el.querySelector("input")?.value === "H");
    const target = rows.find((el) => el.querySelector("input")?.value === "A");
    const dt = new DataTransfer();
    source
      .querySelector("button")
      .dispatchEvent(
        new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
      );
    target.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const manual = ["H", "A", "B", "F", "C", "D", "E", "G"];
  await wait(
    () =>
      [...document.querySelectorAll(".anke-variant input")][0]?.value === "H",
  );
  assert.deepEqual(await mainOrder(), manual);
  const stats = await usage();
  assert.equal(stats["../F.svg"].count, 8);
  assert.equal(stats["../F.svg"].heat, 0);
  assert.equal(stats["../G.svg"].heat, 0);
  assert.equal(stats["../H.svg"], undefined, "Reordering is not an insertion");
  assert.ok(
    stats["../I.svg"].heat > 2,
    "Reordering one group must not reset another",
  );
  assert.equal(
    await call(async (role) => {
      const text = await app.vault.read(app.vault.getFileByPath(role));
      return (
        text.includes("Keep these notes.") &&
        text.indexOf("[H]") < text.indexOf("[A]") &&
        text.indexOf("[F]") < text.indexOf("[C]")
      );
    }, role),
    true,
  );
  await select("Other");
  await select("Alpha");
  assert.deepEqual(await mainOrder(), manual);
  await call(async (role) => {
    const file = app.vault.getFileByPath(role);
    await app.vault.modify(
      file,
      (await app.vault.read(file)).replace("[F]", "[Renamed F]"),
    );
  }, role);
  assert.equal((await usage())["../F.svg"].count, 8);
  const renamed = role.replace("/Alpha.md", "/Renamed.md");
  await call(
    async (role, renamed) =>
      app.fileManager.renameFile(app.vault.getFileByPath(role), renamed),
    role,
    renamed,
  );
  role = renamed;
  await wait(
    (role) =>
      app.plugins.plugins["anke-writing"].data.variantUsage[role]?.["../F.svg"]
        ?.count === 8,
    role,
  );
  await call(async () => {
    const p = app.plugins.plugins["anke-writing"];
    await p.persist();
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
  });
  assert.equal((await usage())["../F.svg"].count, 8);
  assert.equal((await usage())["../F.svg"].heat, 0);
  assert.equal(
    await call(
      (root) =>
        Object.keys(
          app.plugins.plugins["anke-writing"].data.variantUsage,
        ).filter((path) => path.startsWith(root + "/")).length,
      root,
    ),
    1,
  );
  console.log(
    "PASS: click/search/drop counts; bounded ranking on revisit; stable active sidebar; original outline; relevance before heat; visual drag writes Markdown and resets only its group; description/file rename and reload preserve usage; characters are isolated",
  );
} finally {
  await key("Escape", "Escape", 27);
  await call(async (root) => {
    const state = window.rankingCheck;
    if (!state) return;
    if (state.leaf.view.save) await state.leaf.view.save();
    await state.leaf.setViewState({ type: "empty", state: {} });
    state.leaf.detach();
    const p = app.plugins.plugins["anke-writing"];
    for (const path of Object.keys(p.data.variantUsage))
      if (path.startsWith(root + "/")) delete p.data.variantUsage[path];
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (key) => !key.startsWith(root + "/"),
    );
    await p.persist();
    if (state.active)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    if (p.views()[0]) p.views()[0].characterPath = state.character;
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0]?.render();
    delete window.rankingCheck;
  }, root);
  c.close();
}
