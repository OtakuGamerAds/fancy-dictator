// Publish a new version to GitHub Releases; installed apps pick it up through their update button.
//   1. Bump "version" in package.json (e.g. 0.1.0 -> 0.1.1) and commit.
//   2. pnpm release
// It tags the commit (vX.Y.Z), pushes the tag, then builds the installer and uploads it with
// latest.yml (what electron-updater reads). The GitHub token comes from the signed-in GitHub CLI
// (`gh auth login`); nothing is stored here.
import { execSync } from "node:child_process";
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${version}`;
const token = execSync("gh auth token", { encoding: "utf8" }).trim();
if (!token) throw new Error("Sign in with `gh auth login` first.");

const sh = (command) => execSync(command, { encoding: "utf8" }).trim();
const run = (command) => execSync(command, { stdio: "inherit", env: { ...process.env, GH_TOKEN: token } });

if (sh("git status --porcelain")) throw new Error("Commit your changes before releasing.");
// A published GitHub release must point at an existing tag.
if (!sh(`git tag --list ${tag}`)) run(`git tag ${tag}`);
run(`git push origin main ${tag}`);
run("pnpm build");
run("pnpm exec electron-builder --win --publish always");
