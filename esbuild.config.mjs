import { build } from "esbuild";
import { builtinModules } from "node:module";
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
  appendFile,
} from "node:fs/promises";
await mkdir("dist/anke-writing", { recursive: true });
const result = await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/anke-writing/main.js",
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "node",
  sourcemap: false,
  metafile: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
});
for (const name of ["manifest.json", "styles.css", "LICENSE"])
  await copyFile(name, `dist/anke-writing/${name}`);
let notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const packages = new Set(
  Object.keys(result.metafile.inputs).flatMap((path) => {
    const match = path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    return match ? [match[1]] : [];
  }),
);
for (const name of [...packages].sort()) {
  const root = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  const license = (await readdir(root)).find((file) =>
    /^licen[sc]e(?:\.md|\.txt)?$/i.test(file),
  );
  if (!license && name !== "format")
    throw new Error(`Missing distributable license text: ${name}`);
  notices += `\n\n## ${name} ${metadata.version} — ${metadata.license || metadata.licenses?.[0]?.type}\n\n${await readFile(name === "format" ? "licenses/format-MIT.txt" : `${root}/${license}`, "utf8")}`;
}
await writeFile("dist/anke-writing/THIRD_PARTY_NOTICES.md", notices);

// Community installs fetch main.js, manifest.json and styles.css only.
const license = await readFile("LICENSE", "utf8");
await appendFile(
  "dist/anke-writing/main.js",
  `\n/*\n${(license + "\n\n" + notices).replace(/\*\//g, "* /")}\n*/\n`,
);
