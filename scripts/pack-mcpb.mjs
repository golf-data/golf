import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputName = "golf.mcpb";
const outputPath = path.join(root, outputName);
const identifier =
  "https://github.com/golf-data/golf/releases/download/v1.0.0/golf.mcpb";

const staging = await mkdtemp(path.join(tmpdir(), "golf-mcpb-"));

try {
  await copyFile(
    path.join(root, "manifest.json"),
    path.join(staging, "manifest.json"),
  );
  await copyFile(
    path.join(root, "package.json"),
    path.join(staging, "package.json"),
  );
  await copyFile(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
  await cp(path.join(root, "dist"), path.join(staging, "dist"), {
    recursive: true,
  });

  execFileSync(
    "npx",
    ["--yes", "@anthropic-ai/mcpb", "pack", staging, outputPath],
    { cwd: root, stdio: "inherit" },
  );

  const bytes = await readFile(outputPath);
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");

  const serverPath = path.join(root, "server.json");
  const server = JSON.parse(await readFile(serverPath, "utf8"));
  const pkg = server.packages?.[0];
  if (!pkg || pkg.registryType !== "mcpb") {
    throw new Error("server.json is missing an mcpb package entry");
  }
  pkg.identifier = identifier;
  pkg.fileSha256 = fileSha256;
  await writeFile(serverPath, `${JSON.stringify(server, null, 2)}\n`);

  console.log(`Packed ${outputName} (${bytes.length} bytes)`);
  console.log(`SHA-256 ${fileSha256}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
