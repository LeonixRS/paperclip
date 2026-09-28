import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readPaperclipRuntimeSkillEntries } from "@paperclipai/adapter-utils/server-utils";
import { isOtherPaperclipCopyOfSkill, reconcileHermesPaperclipSkills } from "./skills.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A skill folder as another Paperclip install would ship it. */
async function otherInstallSkill(runtimeName: string): Promise<string> {
  const root = await tempDir("other-paperclip-");
  const dir = path.join(root, "skills", runtimeName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: old\n---\n", "utf8");
  return dir;
}

describe("reconcileHermesPaperclipSkills", () => {
  it("re-points a skill link left by another Paperclip install", async () => {
    const config = { env: { HOME: await tempDir("hermes-home-") } };
    const [entry] = await readPaperclipRuntimeSkillEntries(config, moduleDir);
    expect(entry, "the repo ships Paperclip runtime skills").toBeTruthy();
    const skillsHome = path.join(config.env.HOME, ".hermes", "skills");
    await fs.mkdir(skillsHome, { recursive: true });
    const target = path.join(skillsHome, entry!.runtimeName);
    const stale = await otherInstallSkill(entry!.runtimeName);
    await fs.symlink(stale, target);

    await reconcileHermesPaperclipSkills(config, [entry!.key]);

    expect(path.resolve(skillsHome, await fs.readlink(target))).toBe(path.resolve(entry!.source));
    // The other install itself is left as it was.
    await expect(fs.stat(path.join(stale, "SKILL.md"))).resolves.toBeTruthy();
  });

  it("leaves a real folder alone and says how to move it aside", async () => {
    const config = { env: { HOME: await tempDir("hermes-home-") } };
    const [entry] = await readPaperclipRuntimeSkillEntries(config, moduleDir);
    const target = path.join(config.env.HOME, ".hermes", "skills", entry!.runtimeName);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "SKILL.md"), "mine", "utf8");

    await expect(reconcileHermesPaperclipSkills(config, [entry!.key])).rejects.toThrow(
      `mv "${target}" "${target}.bak"`,
    );
    await expect(fs.readFile(path.join(target, "SKILL.md"), "utf8")).resolves.toBe("mine");
  });
});

describe("isOtherPaperclipCopyOfSkill", () => {
  it("matches the same skill folder in another tree, and nothing else", async () => {
    const other = await otherInstallSkill("para-memory-files");
    expect(await isOtherPaperclipCopyOfSkill(other, "/repo/skills/para-memory-files")).toBe(true);
    expect(await isOtherPaperclipCopyOfSkill(other, "/repo/skills/paperclip")).toBe(false);
    expect(await isOtherPaperclipCopyOfSkill(path.dirname(other), "/repo/skills")).toBe(false);
  });
});
