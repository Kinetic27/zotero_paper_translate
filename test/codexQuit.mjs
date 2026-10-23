import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runs separately: a real application quit cannot produce a Mocha completion
// receipt. Inspect the completed encrypted write and persisted logout instead.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this diagnostic using npm run test:codex-quit.");
const evidence = await mkdtemp(join(tmpdir(), "codex-quit-"));
const marker = join(evidence, "encrypted-write.json");
const wrapper = join(root, "test", `__codexQuit-${process.pid}.test.ts`);
const source = `
import { loginCodex, logoutCodex } from "../src/modules/codex";
import { clearCodexCredentials } from "../src/modules/codexCredentials";
if (Services.env.get("PERSONAL_ZOTERO_QUIT_TEST") === ${JSON.stringify(evidence)}) {
describe.only("ChatGPT actual application quit", function () {
  this.timeout(15000);
  it("drains a pending encrypted write and logout before exiting", async function () {
    assert.isTrue(Zotero.DataDirectory.dir.replace(/\\\\/g, "/").endsWith("/.scaffold/test/data"));
    await clearCodexCredentials();
    const manager = Services.logins.QueryInterface!(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIVariant) as any;
    const add = manager.addLoginAsync;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    manager.addLoginAsync = async (...args: unknown[]) => {
      started();
      await Zotero.Promise.delay(1000);
      const value = await add.apply(manager, args);
      await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify({ zoteroVersion: Zotero.version, encryptedWriteCompleted: true }));
      return value;
    };
    let authUrl = "";
    Zotero.launchURL = ((url: string) => { authUrl = url; }) as typeof Zotero.launchURL;
    const request = Zotero.HTTP.request;
    const payload = btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "quit-test-account" } })).replace(/=+$/, "");
    Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
      if (url === "https://auth.openai.com/oauth/token") return { status: 200, responseText: JSON.stringify({ access_token: "e30." + payload + ".test", refresh_token: "quit-test-refresh", expires_in: 3600 }) };
      return request.call(Zotero.HTTP, method, url, options);
    }) as typeof Zotero.HTTP.request;
    await loginCodex();
    const state = new URL(authUrl).searchParams.get("state")!;
    const callback = await request.call(Zotero.HTTP, "GET", "http://localhost:1455/auth/callback?code=quit-test&state=" + encodeURIComponent(state), { successCodes: false, logBodyLength: 0, debug: false });
    assert.equal(callback.status, 200);
    await writing;
    void logoutCodex().catch(() => undefined);
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  });
});
}
`;

await writeFile(wrapper, source, { flag: "wx" });
try {
  const result = spawnSync(
    process.execPath,
    [npm, "test", "--", "--no-watch"],
    {
      cwd: root,
      env: { ...process.env, CI: "1", PERSONAL_ZOTERO_QUIT_TEST: evidence },
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  await writeFile(
    join(evidence, "native.log"),
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    "Native quit runner failed; inspect native.log",
  );
  let completed;
  try {
    completed = JSON.parse(await readFile(marker, "utf8"));
  } catch {
    throw new Error(
      "Zotero exited before the pending encrypted credential write completed.",
    );
  }
  assert.equal(completed.encryptedWriteCompleted, true);
  const store = JSON.parse(
    await readFile(
      join(root, ".scaffold", "test", "profile", "logins.json"),
      "utf8",
    ),
  );
  assert.ok(
    Array.isArray(store.logins),
    "The native encrypted login store was not readable",
  );
  assert.equal(
    store.logins.some(
      (entry) =>
        entry.hostname === "chrome://zoteroPaperTranslate" &&
        entry.httpRealm === "ChatGPT OAuth",
    ),
    false,
    "Logout left credentials in the native store after application exit",
  );
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      { ...completed, logoutPersisted: true, ordinaryMochaCompletion: false },
      null,
      2,
    ),
  );
  console.log(`Actual Zotero quit regression passed: ${evidence}`);
} finally {
  await rm(wrapper);
  console.log(`Quit regression evidence: ${evidence}`);
}
