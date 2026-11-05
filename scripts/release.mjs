// Publish a new version to GitHub Releases; installed apps pick it up through their update button.
//   1. Bump "version" in package.json (e.g. 0.1.0 -> 0.1.1) and commit.
//   2. pnpm release
// It tags the commit (vX.Y.Z), pushes it, builds the installer, and uploads the three files
// electron-updater needs: the installer, its .blockmap (for downloading only what changed) and
// latest.yml (the feed apps read). Uploading is done with the GitHub CLI rather than
// electron-builder's publisher, which dropped files more than once; it is safe to re-run.
import { execSync } from "node:child_process";
import fs from "node:fs";

const REPO = "OtakuGamerAds/fancy-dictator";
const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${version}`;

const sh = (command) => execSync(command, { encoding: "utf8" }).trim();
const run = (command) => execSync(command, { stdio: "inherit" });

if (sh("git status --porcelain")) throw new Error("Commit your changes before releasing.");
if (!sh("gh auth token")) throw new Error("Sign in with `gh auth login` first.");

// A published GitHub release must point at an existing tag.
if (!sh(`git tag --list ${tag}`)) run(`git tag ${tag}`);
run(`git push origin main ${tag}`);

run("pnpm build");
run("pnpm exec electron-builder --win --publish never");

const installer = `release/Fancy-Dictator-Setup-${version}.exe`;
const files = [installer, `${installer}.blockmap`, "release/latest.yml"];
for (const file of files) if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

const exists = (() => {
  try {
    sh(`gh release view ${tag} --repo ${REPO}`);
    return true;
  } catch {
    return false;
  }
})();
const quoted = files.map((f) => `"${f}"`).join(" ");
if (!exists) run(`gh release create ${tag} --repo ${REPO} --title ${tag} --notes "" ${quoted}`);
else run(`gh release upload ${tag} --repo ${REPO} --clobber ${quoted}`);

// latest.yml must describe the installer that was uploaded with it.
const assets = JSON.parse(sh(`gh release view ${tag} --repo ${REPO} --json assets`)).assets.map((a) => a.name);
for (const file of files) {
  const name = file.split("/").pop();
  if (!assets.includes(name)) throw new Error(`${name} is missing from the ${tag} release`);
}
console.log(`Published ${tag}: ${assets.join(", ")}`);
