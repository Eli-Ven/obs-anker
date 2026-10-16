import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for workspace state");
};
try {
  const projects = await call(() => {
    const plugin = app.plugins.plugins["anke-writing"];
    const panel = plugin.views()[0];
    window.ankeWorkspaceCheck = {
      active: app.workspace.activeLeaf,
      leaves: new Set(app.workspace.getLeavesOfType("markdown")),
      characterPath: panel.characterPath,
      leaf: app.workspace.getLeaf("tab"),
    };
    return plugin.library
      .projects()
      .filter((p) => plugin.library.characters(p).length)
      .slice(0, 2)
      .map((p) => ({
        file: p.file.path,
        character: plugin.library.characters(p)[0].file.path,
      }));
  });
  assert.equal(
    projects.length,
    2,
    "The test vault needs two projects with characters",
  );
  for (const project of projects) {
    await call(async (path) => {
      await window.ankeWorkspaceCheck.leaf.openFile(
        app.vault.getFileByPath(path),
      );
    }, project.file);
    await waitFor(() =>
      call(
        (path) =>
          app.plugins.plugins["anke-writing"].views()[0].characterPath === path,
        project.character,
      ),
    );
  }
  console.log(
    "PASS: reusing one tab for different project notes updates the character panel",
  );

  const panel = await call(() => {
    const v = app.plugins.plugins["anke-writing"].views()[0];
    const tabs = v.containerEl.closest(".workspace-tabs");
    return {
      selector: !!v.contentEl.querySelector("select[aria-label='创作项目']"),
      projectButton: [...v.contentEl.querySelectorAll("button")].some(
        (b) => b.textContent === "+ 项目",
      ),
      strip: getComputedStyle(
        tabs.querySelector(".workspace-tab-header-container"),
      ).display,
      tabCount: tabs.querySelector(".workspace-tab-container").children.length,
    };
  });
  assert.equal(panel.selector, false);
  assert.equal(panel.projectButton, false);
  if (panel.tabCount === 1) assert.equal(panel.strip, "none");
  console.log(
    "PASS: project selector and redundant single-panel tab strip are hidden",
  );

  for (const group of [false, true]) {
    const destination = await call(async (group) => {
      const plugin = app.plugins.plugins["anke-writing"];
      const v = plugin.views()[0];
      const file = app.vault.getFileByPath(v.characterPath);
      const project = plugin.library.projectFor(file);
      const character = plugin.library
        .characters(project)
        .find((c) => c.file === file);
      const target = group
        ? (await plugin.library.groups(character))[0].file
        : file;
      const count = app.workspace
        .getLeavesOfType("markdown")
        .filter((l) => l.getViewState().state?.file === target.path).length;
      return { path: target.path, count };
    }, group);
    for (let repeat = 0; repeat < 3; repeat++) {
      await call(
        (group, destination) => {
          const panel =
            app.plugins.plugins["anke-writing"].views()[0].contentEl;
          if (group) {
            [...panel.querySelectorAll(".anke-group-heading")]
              .find((el) => el.title === destination)
              .dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                }),
              );
            [...document.querySelectorAll(".menu-item")]
              .find((el) => el.textContent.includes("打开差分文件"))
              .click();
          } else {
            [...panel.querySelectorAll(".anke-details > .anke-toolbar button")]
              .find((b) => b.textContent.endsWith(" ↗"))
              .click();
          }
        },
        group,
        destination.path,
      );
      await waitFor(() =>
        call(
          (path) => app.workspace.getActiveFile()?.path === path,
          destination.path,
        ),
      );
      assert.equal(
        await call(
          (path) =>
            app.workspace
              .getLeavesOfType("markdown")
              .filter((l) => l.getViewState().state?.file === path).length,
          destination.path,
        ),
        Math.max(1, destination.count),
      );
    }
  }
  console.log(
    "PASS: repeated character and variant links reuse the existing tab",
  );

  const ordinary = await call(
    () =>
      app.vault
        .getMarkdownFiles()
        .find((f) => !app.plugins.plugins["anke-writing"].library.projectFor(f))
        ?.path,
  );
  assert.ok(ordinary, "The test vault needs a note outside all projects");
  await call(async (path) => {
    await window.ankeWorkspaceCheck.leaf.openFile(
      app.vault.getFileByPath(path),
    );
    app.workspace.setActiveLeaf(window.ankeWorkspaceCheck.leaf, {
      focus: true,
    });
  }, ordinary);
  await waitFor(() =>
    call(() =>
      app.plugins.plugins["anke-writing"]
        .views()[0]
        .contentEl.textContent.includes("当前文件不属于写作项目"),
    ),
  );
  assert.equal(
    await call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-character").length,
    ),
    0,
  );
  console.log(
    "PASS: unrelated notes clear the project panel instead of retaining stale roles",
  );
} finally {
  await call(() => {
    const state = window.ankeWorkspaceCheck;
    if (!state) return;
    for (const leaf of app.workspace.getLeavesOfType("markdown"))
      if (!state.leaves.has(leaf)) leaf.detach();
    app.plugins.plugins["anke-writing"].views()[0].characterPath =
      state.characterPath;
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    delete window.ankeWorkspaceCheck;
  });
  c.close();
}
