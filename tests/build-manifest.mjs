import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(name => name && name !== "SHA256SUMS.txt")
  .sort();
if (!paths.length) throw new Error("Nenhum arquivo no índice do repositório.");
const lines = [];
for (const name of paths) {
  const bytes = await readFile(path.join(root, name));
  lines.push(createHash("sha256").update(bytes).digest("hex") + "  " + name);
}
await writeFile(path.join(root, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log("Manifesto gerado para " + lines.length + " arquivos versionados.");
