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
  throw Error("Description check timed out: " + fn);
};
const root = `DescriptionCheck-${Date.now()}`;
try {
  await call(async (root) => {
    if (document.querySelector(".modal,.prompt"))
      throw Error("Close dialogs before testing");
    const p = app.plugins.plugins["anke-writing"];
    window.descriptionCheck = {
      active: app.workspace.activeLeaf,
      character: p.views()[0]?.characterPath,
      leaves: [],
    };
    await p.openCharacters();
    await p.library.createProject(root);
    await app.vault.create(
      root + "/portrait.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="green"/></svg>',
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
    const p = app.plugins.plugins["anke-writing"];
    const file = await p.library.createCharacter(
      p.library.projects().find((p) => p.root === root),
      "Alpha",
    );
    await app.vault.append(
      file,
      Array.from(
        { length: 100 },
        (_, i) => `- [差分${i}](../portrait.svg)`,
      ).join("\n") + "\n",
    );
    const leaf = app.workspace.getLeaf("tab");
    window.descriptionCheck.leaves.push(leaf);
    await leaf.openFile(app.vault.getFileByPath(root + "/1-1 第一章.md"));
    app.workspace.setActiveLeaf(leaf, { focus: true });
    p.data.variantUsage[file.path] = {
      "../portrait.svg": { count: 11, heat: 7, updatedAt: Date.now() },
    };
    return file.path;
  }, root);
  await wait(
    (role) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        role && document.querySelectorAll(".anke-variant input").length === 100,
    role,
  );
  for (const background of [false, true]) {
    if (background)
      await call(async (role) => {
        const leaf = app.workspace.getLeaf("tab");
        window.descriptionCheck.leaves.push(leaf);
        await leaf.setViewState({
          type: "markdown",
          state: { file: role, mode: "source", source: true },
          active: true,
        });
        app.workspace.setActiveLeaf(window.descriptionCheck.leaves[0], {
          focus: true,
        });
        await app.plugins.plugins["anke-writing"].views()[0].render();
      }, role);
    const target = background ? "差分65" : "差分45";
    const before = await call((target) => {
      const input = [...document.querySelectorAll(".anke-variant input")].find(
        (el) => el.value === target,
      );
      const grid = input.closest(".anke-variant-grid");
      grid.scrollTop +=
        input.getBoundingClientRect().top -
        grid.getBoundingClientRect().top -
        100;
      input.focus({ preventScroll: true });
      input.select();
      window.descriptionCheck.input = input;
      return {
        scroll: grid.scrollTop,
        labels: [...grid.querySelectorAll("input")].map((el) => el.value),
        top:
          input.getBoundingClientRect().top - grid.getBoundingClientRect().top,
      };
    }, target);
    await c.send("Input.insertText", { text: target + "改名" });
    for (const type of ["keyDown", "keyUp"])
      await c.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    await wait(() => !window.descriptionCheck.input.isConnected);
    const after = await call((target) => {
      const input = [...document.querySelectorAll(".anke-variant input")].find(
        (el) => el.value === target + "改名",
      );
      const grid = input.closest(".anke-variant-grid");
      return {
        scroll: grid.scrollTop,
        labels: [...grid.querySelectorAll("input")].map((el) => el.value),
        top:
          input.getBoundingClientRect().top - grid.getBoundingClientRect().top,
      };
    }, target);
    console.log({
      background,
      before: {
        scroll: before.scroll,
        top: before.top,
        index: before.labels.indexOf(target),
      },
      after: {
        scroll: after.scroll,
        top: after.top,
        index: after.labels.indexOf(target + "改名"),
      },
    });
    assert.deepEqual(after.labels, [
      target + "改名",
      ...before.labels.filter((label) => label !== target),
    ]);
    assert.equal(after.scroll, 0, "The edited group scrolls to the first row");
    const labels = await call(async (role) => {
      const p = app.plugins.plugins["anke-writing"];
      const project = p.library.projectFor(app.vault.getFileByPath(role));
      const character = p.library
        .characters(project)
        .find((item) => item.file.path === role);
      return (await p.library.groups(character))[0].entries.map(
        (row) => row.label,
      );
    }, role);
    assert.deepEqual(
      labels,
      after.labels,
      "The Markdown source saves the promoted order",
    );
  }
  const beforeReload = await call(() =>
    [...document.querySelectorAll(".anke-variant input")].map((el) => el.value),
  );
  await call(() => {
    const input = document.querySelectorAll(".anke-variant input")[20];
    input.focus();
    window.descriptionCheck.input = input;
    input.blur();
    return input.value;
  });
  await wait(() => !window.descriptionCheck.input.isConnected);
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".anke-variant input")].map(
        (el) => el.value,
      ),
    ),
    beforeReload,
    "Unchanged descriptions do not move",
  );
  await call(async () => {
    for (const leaf of window.descriptionCheck.leaves)
      if (leaf.view.save) await leaf.view.save();
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    await app.plugins.plugins["anke-writing"].openCharacters();
  });
  await wait(
    () => document.querySelectorAll(".anke-variant input").length === 100,
  );
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".anke-variant input")].map(
        (el) => el.value,
      ),
    ),
    beforeReload,
    "Promoted order survives plugin reload",
  );
  const usage = await call(
    (role) =>
      app.plugins.plugins["anke-writing"].data.variantUsage[role][
        "../portrait.svg"
      ],
    role,
  );
  assert.equal(usage.count, 11, "Editing retains lifetime usage count");
  assert.equal(
    usage.heat,
    0,
    "Automatic popularity does not displace the edited first row",
  );
  console.log(
    "PASS: promotion and scroll-to-top with the role file closed or open, unchanged text stays in place, order persists after reload, and usage counts are retained.",
  );
} finally {
  await call(async (root) => {
    const state = window.descriptionCheck;
    if (!state) return;
    for (const leaf of state.leaves) {
      if (leaf.view.save) await leaf.view.save();
      await leaf.setViewState({ type: "empty", state: {} });
      leaf.detach();
    }
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    const p = app.plugins.plugins["anke-writing"];
    if (p.views()[0]) p.views()[0].characterPath = state.character;
    for (const path of Object.keys(p.data.variantUsage))
      if (path.startsWith(root + "/")) delete p.data.variantUsage[path];
    await p.persist();
    const folder = app.vault.getFolderByPath(root);
    if (folder) await app.vault.trash(folder, false);
    await p.views()[0]?.render();
    delete window.descriptionCheck;
  }, root);
  c.close();
}
