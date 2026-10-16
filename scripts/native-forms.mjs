import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const root = `FormCheck-${Date.now()}`;
const deadline = setTimeout(() => {
  console.error("FAIL: form test timed out or blocked the renderer event loop");
  process.exit(1);
}, 30000);
const waitFor = async (fn, ...args) => {
  for (let i = 0; i < 100; i++) {
    if (await call(fn, ...args)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Form condition did not become true");
};
const setName = (name) =>
  call((name) => {
    const input = document.querySelector(".modal input");
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }, name);
const open = () =>
  call((root) => {
    const p = app.plugins.plugins["anke-writing"];
    p.newCharacter(
      p.library.projects().find((project) => project.root === root),
    );
  }, root);
const enter = async () => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
};
const saved = (name) =>
  waitFor(
    (root, name) => {
      const p = app.plugins.plugins["anke-writing"];
      const project = p.library
        .projects()
        .find((project) => project.root === root);
      return (
        !document.querySelector(".modal") &&
        project &&
        p.library.characters(project).some((role) => role.name === name)
      );
    },
    root,
    name,
  );

try {
  assert.equal(
    await call(() => !!document.querySelector(".modal")),
    false,
    "Close existing test-vault dialogs before running form checks",
  );
  await call(async (root) => {
    const folder = await app.vault.createFolder(root);
    await app.plugins.plugins["anke-writing"].library.initProject(folder);
  }, root);
  await waitFor(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((project) => project.root === root),
    root,
  );

  await open();
  await setName("Enter role");
  await enter();
  await saved("Enter role");

  await open();
  await setName("中文角色");
  for (const flags of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
  ]) {
    await call(
      (flags) =>
        document.querySelector(".modal input").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
            ...flags,
          }),
        ),
      flags,
    );
    assert.equal(
      await call(() => !!document.querySelector(".modal input")),
      true,
    );
  }
  assert.equal(
    await call(
      (root) =>
        app.vault.getAbstractFileByPath(
          `${app.plugins.plugins["anke-writing"].library.characterFolder(root)}/中文角色`,
        ) !== null,
      root,
    ),
    false,
    "IME/held/modified Enter must not submit",
  );
  // Two keydowns in one event turn exercise the disabled-button guard.
  await call(() => {
    const input = document.querySelector(".modal input");
    for (let i = 0; i < 2; i++)
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await saved("中文角色");
  assert.equal(
    await call((root) => {
      const p = app.plugins.plugins["anke-writing"];
      return p.library
        .projects()
        .find((project) => project.root === root)
        .characters.filter((link) => link.includes("中文角色")).length;
    }, root),
    1,
    "Repeated Enter must not create duplicate character links",
  );

  await open();
  await enter();
  await waitFor(() => !!document.querySelector(".notice"));
  assert.equal(
    await call(() => !!document.querySelector(".modal input")),
    true,
    "Invalid name must keep the form open",
  );
  await waitFor(
    () => document.querySelector(".modal button.mod-cta")?.disabled === false,
  );
  await setName("Retry role");
  await enter();
  await saved("Retry role");

  await open();
  await setName("Click role");
  await call(() => document.querySelector(".modal button.mod-cta").click());
  await saved("Click role");

  await call(() => app.plugins.plugins["anke-writing"].newProject());
  await setName(`${root}-not-created`);
  await enter();
  assert.equal(
    await call(() => !!document.querySelector(".modal input")),
    true,
    "Other forms must not gain Enter submission",
  );
  assert.equal(
    await call(
      (root) => app.vault.getAbstractFileByPath(`${root}-not-created`) !== null,
      root,
    ),
    false,
  );
  console.log(
    "PASS: native Enter saves; IME, repeat and modifiers do not; duplicate submits blocked; validation retry and mouse save work; other forms unchanged",
  );
} finally {
  await call(async (root) => {
    document.querySelector(".modal-close-button")?.click();
    const folder = app.vault.getAbstractFileByPath(root);
    if (folder) await app.vault.trash(folder, false);
  }, root);
  clearTimeout(deadline);
  c.close();
}
