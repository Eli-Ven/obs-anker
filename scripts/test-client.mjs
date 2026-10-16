import { resolve as resolvePath } from "node:path";
import { writeFile } from "node:fs/promises";
export async function connect() {
  const targets = await (await fetch("http://127.0.0.1:9237/json/list")).json();
  const target = targets.find(
    (t) => t.type === "page" && t.url.startsWith("app://obsidian.md"),
  );
  if (!target) throw new Error("Isolated Obsidian test window not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? callback.reject(message.error)
        : callback.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      pending.set(request, { resolve, reject });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text +
          ": " +
          JSON.stringify(result.exceptionDetails.exception),
      );
    return result.result.value;
  };
  const vault = await evaluate("app.vault.adapter.basePath");
  if (resolvePath(vault) !== resolvePath(".test-vault")) {
    socket.close();
    throw new Error("Refusing to interact with a non-test vault: " + vault);
  }
  return {
    send,
    evaluate,
    close: () => socket.close(),
    screenshot: async (path) => {
      const result = await send("Page.captureScreenshot");
      await writeFile(path, Buffer.from(result.data, "base64"));
    },
  };
}
