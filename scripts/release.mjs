// Publish a new version to GitHub Releases; installed apps pick it up through their update button.
//   1. Bump "version" in package.json (e.g. 0.1.0 -> 0.1.1).
//   2. pnpm release
// The GitHub token comes from the signed-in GitHub CLI (`gh auth login`); nothing is stored here.
import { execSync } from "node:child_process";

const token = execSync("gh auth token", { encoding: "utf8" }).trim();
if (!token) throw new Error("Sign in with `gh auth login` first.");

const run = (command) => execSync(command, { stdio: "inherit", env: { ...process.env, GH_TOKEN: token } });
run("pnpm build");
run("pnpm exec electron-builder --win --publish always");
