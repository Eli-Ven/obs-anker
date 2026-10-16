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
  console.log("Timed-out state:", await call(state));
  throw Error("Character navigation condition timed out: " + fn);
};
const click = async (title, link = false) => {
  const point = await call(
    (title, link) => {
      const selector = link
        ? ".anke-details > .anke-toolbar button"
        : ".anke-character";
      const el = [...document.querySelectorAll(selector)].find((el) =>
        link ? el.textContent === title + " ↗" : el.title === title,
      );
      if (!el) throw Error("Missing character control: " + title);
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    title,
    link,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await c.send("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
};
const root = `NavigationCheck-${Date.now()}`;
const state = () => {
  const p = app.plugins.plugins["anke-writing"],
    v = p.views()[0];
  return {
    active: app.workspace.activeLeaf?.view.getViewType(),
    file: app.workspace.getActiveFile()?.path,
    recent: app.workspace.getMostRecentLeaf(v.leaf.getContainer())?.view.file
      ?.path,
    selected: v.characterPath,
    browser: v.contentEl.querySelector(".anke-variant-browser")?.dataset
      .character,
    outline: [...v.contentEl.querySelectorAll(".anke-outline-heading")].map(
      (el) => el.textContent,
    ),
  };
};
try {
  await c.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  await call(async (root) => {
    if (document.querySelector(".modal,.prompt"))
      throw Error("Close dialogs before testing");
    const p = app.plugins.plugins["anke-writing"];
    window.navigationCheck = {
      active: app.workspace.activeLeaf,
      character: p.views()[0]?.characterPath,
    };
    await p.openCharacters();
    await p.library.createProject(root);
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((p) => p.root === root),
    root,
  );
  const roles = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((p) => p.root === root);
    const paths = [];
    for (const name of ["Alpha", "Beta"]) {
      const file = await p.library.createCharacter(project, name);
      await app.vault.append(file, "# " + name + " notes\n");
      paths.push(file.path);
    }
    return paths;
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
  await call(async (path) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(app.vault.getFileByPath(path));
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, roles[0]);
  await wait(
    (path) =>
      app.plugins.plugins["anke-writing"].views()[0].characterPath === path,
    roles[0],
  );
  await click("Beta");
  await new Promise((r) => setTimeout(r, 700));
  console.log("After opening Beta:", await call(state));
  await wait(
    (path) =>
      app.workspace.getActiveFile()?.path === path &&
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        path,
    roles[1],
  );
  assert.ok((await call(state)).outline.includes("Beta notes"));
  const count = await call(
    () => app.workspace.getLeavesOfType("markdown").length,
  );
  for (const index of [0, 1, 0]) {
    await click(index ? "Beta" : "Alpha");
    await wait(
      (path) =>
        app.workspace.getActiveFile()?.path === path &&
        document.querySelector(".anke-variant-browser")?.dataset.character ===
          path,
      roles[index],
    );
    assert.ok(
      (await call(state)).outline.includes(
        (index ? "Beta" : "Alpha") + " notes",
      ),
    );
  }
  assert.equal(
    await call(() => app.workspace.getLeavesOfType("markdown").length),
    count,
    "Reuse existing character tabs",
  );
  await call(async (root) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(app.vault.getFileByPath(root + "/1-1 第一章.md"));
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, root);
  await wait(() => !document.querySelector(".anke-outline"));
  await click("Beta");
  await wait(
    (path) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
      path,
    roles[1],
  );
  assert.equal(
    await call(() => app.workspace.getMostRecentLeaf().view.file?.path),
    root + "/1-1 第一章.md",
    "Writing-mode selection keeps the chapter open",
  );
  await click("Beta", true);
  await wait(
    (path) =>
      app.workspace.getActiveFile()?.path === path &&
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        path &&
      !!document.querySelector(".anke-outline"),
    roles[1],
  );
  console.log(
    "PASS: real sidebar clicks follow new and reused character tabs, display matching outlines, and retain chapter editing until the file link is clicked.",
  );
} finally {
  await call(async (root) => {
    const state = window.navigationCheck;
    if (!state) return;
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (!leaf.view.file?.path.startsWith(root + "/")) continue;
      if (leaf.view.save) await leaf.view.save();
      await leaf.setViewState({ type: "empty", state: {} });
      leaf.detach();
    }
    const p = app.plugins.plugins["anke-writing"];
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    if (p.views()[0]) p.views()[0].characterPath = state.character;
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0]?.render();
    delete window.navigationCheck;
  }, root);
  c.close();
}
