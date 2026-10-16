import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for preferences state");
};
const root = `PreferencesCheck-${Date.now()}`;
const custom = "^第\\d+章";
const group = `${root}/角色/Alpha/photo/默认.md`;
const setPattern = async (pattern, save = true) => {
  await call(
    (pattern, save) => {
      app.setting.open();
      app.setting.openTabById("anke-writing");
      const container = app.setting.pluginTabs.find(
        (t) => t.id === "anke-writing",
      ).containerEl;
      const row = [...container.querySelectorAll(".setting-item")].find(
        (el) =>
          el.querySelector(".setting-item-name")?.textContent ===
          "正文文件名正则",
      );
      const input = row.querySelector("input");
      input.value = pattern;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (save) row.querySelector("button").click();
    },
    pattern,
    save,
  );
};
const closeSettings = () => call(() => app.setting.close());
const open = async (path, mode = "source") => {
  await call(
    async (path, mode) => {
      const leaf = window.ankePreferencesCheck.leaf;
      await leaf.setViewState({
        type: "markdown",
        state: { file: path, mode },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    path,
    mode,
  );
};
try {
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    window.ankePreferencesCheck = {
      active: app.workspace.activeLeaf,
      leaves: new Set(app.workspace.getLeavesOfType("markdown")),
      character: p.views()[0]?.characterPath,
      pattern: p.data.chapterPattern,
      collapsed: [...p.data.collapsedGroups],
      leaf: app.workspace.getLeaf("tab"),
      root,
    };
    await p.setChapterPattern("^\\d+-\\d+");
    await p.library.createProject(root);
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/1-1 第一章.md`),
      "[dice]1d100[/dice]\n\nBody",
    );
    await app.vault.create(
      `${root}/第1章 自定义.md`,
      "[dice]1d100[/dice]\n\nCustom body",
    );
    await app.vault.create(
      `${root}/普通笔记.md`,
      "---\nanke-type: chapter\n---\n\nOrdinary",
    );
  }, root);
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((p) => p.root === root),
      root,
    ),
  );
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    for (const name of ["Alpha", "Beta"]) {
      await p.library.createCharacter(project, name);
      await app.vault.create(
        `${root}/角色/${name}/assets/test.svg`,
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#abcdef"/></svg>',
      );
      await app.vault.modify(
        app.vault.getFileByPath(`${root}/角色/${name}/photo/默认.md`),
        "---\nanke-type: variants\n---\n\n- [Smile](../assets/test.svg)",
      );
    }
    await app.vault.createFolder(`${root}/角色/Alpha/photo/演出服`);
    await app.vault.create(
      `${root}/角色/Alpha/photo/演出服/站姿.md`,
      "---\nanke-type: variants\n---\n\n- [Standing](../../assets/test.svg)",
    );
  }, root);
  await open(`${root}/1-1 第一章.md`, "preview");
  await waitFor(() =>
    call(
      () =>
        !!window.ankePreferencesCheck.leaf.view.contentEl.querySelector(
          ".anke-badge",
        ),
    ),
  );
  assert.deepEqual(
    await call((root) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root);
      return p.library.chapters(project).map((x) => x.name);
    }, root),
    ["1-1 第一章.md"],
  );
  await setPattern(custom, false);
  assert.equal(
    await call(() => app.plugins.plugins["anke-writing"].data.chapterPattern),
    "^\\d+-\\d+",
  );
  await setPattern(custom);
  await waitFor(() =>
    call(
      (custom) =>
        app.plugins.plugins["anke-writing"].data.chapterPattern === custom,
      custom,
    ),
  );
  await closeSettings();
  await waitFor(() =>
    call(
      () =>
        !window.ankePreferencesCheck.leaf.view.contentEl.querySelector(
          ".anke-badge",
        ),
    ),
  );
  await open(`${root}/第1章 自定义.md`, "preview");
  await waitFor(() =>
    call(
      () =>
        !!window.ankePreferencesCheck.leaf.view.contentEl.querySelector(
          ".anke-badge",
        ),
    ),
  );
  assert.deepEqual(
    await call((root) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root);
      return p.library.chapters(project).map((x) => x.name);
    }, root),
    ["第1章 自定义.md"],
  );
  await setPattern("[");
  await waitFor(() =>
    call(() =>
      [
        ...app.setting.pluginTabs
          .find((t) => t.id === "anke-writing")
          .containerEl.ownerDocument.querySelectorAll(".notice"),
      ].some((n) => n.textContent.includes("Invalid regular expression")),
    ),
  );
  assert.equal(
    await call(
      async () =>
        (await app.plugins.plugins["anke-writing"].loadData()).chapterPattern,
    ),
    custom,
  );
  await setPattern(".*");
  await waitFor(() =>
    call(
      () => app.plugins.plugins["anke-writing"].data.chapterPattern === ".*",
    ),
  );
  assert.deepEqual(
    await call((root) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root);
      return p.library
        .chapters(project)
        .map((x) => x.name)
        .sort();
    }, root),
    ["1-1 第一章.md", "普通笔记.md", "第1章 自定义.md"].sort(),
  );
  await setPattern(custom);
  await waitFor(() =>
    call(
      (custom) =>
        app.plugins.plugins["anke-writing"].data.chapterPattern === custom,
      custom,
    ),
  );
  await closeSettings();
  console.log(
    "PASS: filename regex applies only on save, updates reading previews immediately, rejects invalid syntax, and excludes resource/config files",
  );

  await open(`${root}/第1章 自定义.md`);
  await waitFor(() =>
    call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-character").length === 2,
    ),
  );
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    p.views()[0].select(p.library.characters(project)[0]);
  }, root);
  await waitFor(() =>
    call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-variant-group").length === 2,
    ),
  );
  const before = await call(() => ({
    file: app.workspace.getActiveFile()?.path,
    count: app.workspace.getLeavesOfType("markdown").length,
  }));
  const groups = await call(() =>
    [
      ...app.plugins.plugins["anke-writing"]
        .views()[0]
        .contentEl.querySelectorAll(".anke-variant-group"),
    ].map((el) => ({
      name: el.querySelector(".anke-group-heading").textContent,
      open:
        el
          .querySelector(".anke-group-heading")
          .getAttribute("aria-expanded") === "true",
      nested: !!el.querySelector("details"),
    })),
  );
  assert.deepEqual(
    groups.map((g) => g.name).sort(),
    ["默认", "演出服 / 站姿"].sort(),
  );
  assert.ok(groups.every((g) => g.open && !g.nested));
  await call(
    (group) =>
      [
        ...app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-group-heading"),
      ]
        .find((el) => el.title === group)
        .click(),
    group,
  );
  await waitFor(() =>
    call(
      async (group) =>
        (
          await app.plugins.plugins["anke-writing"].loadData()
        ).collapsedGroups.includes(group),
      group,
    ),
  );
  assert.deepEqual(
    await call(() => ({
      file: app.workspace.getActiveFile()?.path,
      count: app.workspace.getLeavesOfType("markdown").length,
    })),
    before,
  );
  await call((root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    p.views()[0].select(p.library.characters(project)[1]);
  }, root);
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelector(".anke-group-heading")?.title ===
        `${root}/角色/Beta/photo/默认.md`,
      root,
    ),
  );
  assert.equal(
    await call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelector(".anke-group-heading")
          .getAttribute("aria-expanded") === "true",
    ),
    true,
  );
  await call((root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    p.views()[0].select(p.library.characters(project)[0]);
  }, root);
  await waitFor(() =>
    call(
      (group) =>
        [
          ...app.plugins.plugins["anke-writing"]
            .views()[0]
            .contentEl.querySelectorAll(".anke-group-heading"),
        ]
          .find((el) => el.title === group)
          ?.getAttribute("aria-expanded") === "false",
      group,
    ),
  );
  await call(async () => {
    const p = app.plugins.plugins["anke-writing"];
    for (const view of p.views()) view.leaf.detach();
    await p.openCharacters();
  });
  await waitFor(() =>
    call(
      (group) =>
        [
          ...app.plugins.plugins["anke-writing"]
            .views()[0]
            .contentEl.querySelectorAll(".anke-group-heading"),
        ]
          .find((el) => el.title === group)
          ?.getAttribute("aria-expanded") === "false",
      group,
    ),
  );
  const layout = await call(() => {
    const leaf = app.plugins.plugins["anke-writing"].views()[0].leaf;
    const panel = leaf.view.containerEl.getBoundingClientRect();
    const explorer = app.workspace
      .getLeavesOfType("file-explorer")[0]
      .view.containerEl.getBoundingClientRect();
    const left = app.workspace.getLayout().left;
    return {
      left,
      panelY: panel.top,
      explorerBottom: explorer.bottom,
      id: leaf.id,
    };
  });
  assert.ok(JSON.stringify(layout.left.children.at(-1)).includes(layout.id));
  assert.ok(layout.panelY >= layout.explorerBottom - 1);
  const id = layout.id;
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    p.views()[0].select(p.library.characters(project)[1]);
    await p.openCharacters();
  }, root);
  assert.equal(
    await call(
      () => app.plugins.plugins["anke-writing"].views()[0].characterPath,
    ),
    `${root}/角色/Beta/Beta.md`,
  );
  await call((root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    p.views()[0].select(p.library.characters(project)[0]);
  }, root);
  assert.equal(
    await call(() => app.plugins.plugins["anke-writing"].views()[0].leaf.id),
    id,
  );
  console.log(
    "PASS: file headings fold without navigation; states are isolated per file, survive panel closure, and reopening defaults to lower left",
  );

  await call(async () => {
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    await app.plugins.plugins["anke-writing"].openCharacters();
  });
  await waitFor(() =>
    call(
      (group) =>
        [
          ...app.plugins.plugins["anke-writing"]
            .views()[0]
            .contentEl.querySelectorAll(".anke-group-heading"),
        ]
          .find((el) => el.title === group)
          ?.getAttribute("aria-expanded") === "false",
      group,
    ),
  );
  assert.equal(
    await call(() => app.plugins.plugins["anke-writing"].data.chapterPattern),
    custom,
  );
  await call(async (group) => {
    await app.fileManager.renameFile(
      app.vault.getFileByPath(group),
      group.replace("默认.md", "常服.md"),
    );
  }, group);
  const renamed = group.replace("默认.md", "常服.md");
  await waitFor(() =>
    call(
      async (renamed) =>
        (
          await app.plugins.plugins["anke-writing"].loadData()
        ).collapsedGroups.includes(renamed),
      renamed,
    ),
  );
  await waitFor(() =>
    call(
      (renamed) =>
        [
          ...app.plugins.plugins["anke-writing"]
            .views()[0]
            .contentEl.querySelectorAll(".anke-group-heading"),
        ]
          .find((el) => el.title === renamed)
          ?.getAttribute("aria-expanded") === "false",
      renamed,
    ),
  );
  // Verify keyboard activation remains available on native heading buttons.
  await call(
    (renamed) =>
      [
        ...app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-group-heading"),
      ]
        .find((el) => el.title === renamed)
        .focus(),
    renamed,
  );
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  await waitFor(() =>
    call(
      async (renamed) =>
        !(
          await app.plugins.plugins["anke-writing"].loadData()
        ).collapsedGroups.includes(renamed),
      renamed,
    ),
  );
  console.log(
    "PASS: preferences survive plugin reload; fold state follows file renames and supports keyboard toggling",
  );
} finally {
  await call(async () => {
    app.setting.close();
    const state = window.ankePreferencesCheck;
    if (!state) return;
    const p = app.plugins.plugins["anke-writing"];
    await p.setChapterPattern(state.pattern);
    p.data.collapsedGroups = state.collapsed;
    await p.persist();
    for (const leaf of app.workspace.getLeavesOfType("markdown"))
      if (!state.leaves.has(leaf)) leaf.detach();
    const folder = app.vault.getAbstractFileByPath(state.root);
    if (folder) await app.vault.trash(folder, false);
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    if (p.views()[0]) p.views()[0].characterPath = state.character || "";
    p.refresh();
    delete window.ankePreferencesCheck;
  });
  c.close();
}
