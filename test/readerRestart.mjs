import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
assert.ok(npm, "Run using npm run test:reader-restart.");
const evidence = await mkdtemp(join(tmpdir(), "reader-restart-"));
const wrapper = join(root, "test", `__readerRestart-${process.pid}.test.ts`);
const pdfPath = join(evidence, "specimen.pdf");
const statePath = join(evidence, "state.json");
const expected = "재시작 후에도 유지되는 번역.";
const stream = "BT /F1 12 Tf 72 720 Td (Restart cache specimen.) Tj ET";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join(
    "",
  )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await writeFile(pdfPath, pdf);

const source = `
import { config } from "../package.json";
import { elementPrefix } from "../src/utils/elementIdentity";
import { getPref, setPref, clearPref } from "../src/utils/prefs";
if (Services.env.get("ZOTERO_READER_RESTART_TEST") === ${JSON.stringify(evidence)}) {
  describe.only("Reader across real Zotero processes", function () {
    this.timeout(60000);
    it("restores the actual saved translation without another provider request", async function () {
      assert.isTrue(Zotero.DataDirectory.dir.replace(/\\\\/g, "/").endsWith("/.scaffold/test/data"));
      await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
      const phase = Number(Services.env.get("ZOTERO_READER_RESTART_PHASE"));
      const expected = ${JSON.stringify(expected)};
      const keys = ["translateSource", "sourceLanguage", "targetLanguage", "fontSize", "showOriginalPage"];
      let previous: { key: string; value?: string | number | boolean }[] = keys.map(key => ({ key, value: getPref(key) }));
      let item: Zotero.Item | undefined;
      let reader: _ZoteroTypes.ReaderInstance<"pdf"> | undefined;
      let preserve = false;
      let stage = "setup";
      const requests: string[] = [];
      const originalRequest = Zotero.HTTP.request;
      const wait = async (condition: () => boolean) => {
        const deadline = Date.now() + 15000;
        while (!condition()) {
          if (Date.now() > deadline) assert.fail("Restart reader did not settle at " + stage);
          await Zotero.Promise.delay(25);
        }
      };
      Zotero.HTTP.request = (async (method: string, url: string, options: any) => {
        if (url.startsWith("https://translate.googleapis.com/translate_a/single") || url.startsWith("https://translate.google.com/translate_a/single")) {
          const query = new URL(url).searchParams.get("q")!;
          requests.push(query);
          if (phase === 2) throw new Error("A restarted reader must not request translation for a saved page.");
          return { status: 200, response: [[[expected, query]]] };
        }
        return originalRequest.call(Zotero.HTTP, method as "GET", url, options);
      }) as typeof Zotero.HTTP.request;
      const open = async () => {
        reader = await Zotero.Reader.open(item!.id) as _ZoteroTypes.ReaderInstance<"pdf">;
        await reader._initPromise;
        await reader._internalReader._primaryView.initializedPromise;
        const doc = Zotero.getMainWindow().document;
        let panel: HTMLElement | undefined;
        await wait(() => {
          const details = (Array.from(doc.querySelectorAll("item-details")) as (HTMLElement & { tabID: string })[]).find(element => element.tabID === reader!.tabID);
          panel = details?.querySelector(elementPrefix + "-panel") as HTMLElement | undefined;
          return !!panel?.querySelector(".page-result");
        });
        return { panel: panel!, result: panel!.querySelector(".page-result") as HTMLElement & { value: string }, status: panel!.querySelector("[role=status]")! };
      };
      const translate = (panel: HTMLElement) => {
        const event = panel.ownerDocument.createEvent("Event");
        event.initEvent("command", true, false);
        panel.querySelector("#" + config.addonRef + "-translate")!.dispatchEvent(event);
      };
      try {
        if (phase === 1) {
          setPref("translateSource", "googleapi");
          setPref("sourceLanguage", "en");
          setPref("targetLanguage", "ko");
          setPref("fontSize", "21");
          setPref("showOriginalPage", false);
          item = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(pdfPath)} });
          stage = "first translation";
          let view = await open();
          translate(view.panel);
          await wait(() => view.result.value === expected && view.status.textContent!.includes("· saved"));
          assert.lengthOf(requests, 1);
          (reader as unknown as _ZoteroTypes.ReaderTab).close();
          reader = undefined;
          stage = "same-process reopen";
          view = await open();
          await wait(() => view.result.value === expected && view.status.textContent!.includes("saved, cached"));
          assert.lengthOf(requests, 1);
          Services.prefs.savePrefFile(null);
          await IOUtils.writeUTF8(${JSON.stringify(statePath)}, JSON.stringify({ libraryID: item.libraryID, key: item.key, previous }));
          preserve = true;
        } else {
          const state = await IOUtils.readJSON(${JSON.stringify(statePath)}) as { libraryID: number; key: string; previous: typeof previous };
          previous = state.previous;
          item = await Zotero.Items.getByLibraryAndKeyAsync(state.libraryID, state.key);
          assert.isOk(item, "Reopen the same persisted attachment, not a newly imported copy");
          stage = "fresh-process restore";
          const view = await open();
          await wait(() => view.result.value === expected && view.status.textContent!.includes("saved, cached"));
          assert.lengthOf(requests, 0);
          assert.equal(getPref("fontSize"), "21");
          assert.equal(view.result.style.fontSize, "21px");
          stage = "cached Translate after restart";
          translate(view.panel);
          await wait(() => view.status.textContent!.includes("saved, cached"));
          assert.equal(view.result.value, expected);
          assert.lengthOf(requests, 0);
        }
        await IOUtils.writeUTF8(${JSON.stringify(join(evidence, "phase-"))} + phase + ".json", JSON.stringify({ phase, processID: Services.appinfo.processID, zoteroVersion: Zotero.version, requests: requests.length, savedText: expected, completed: true }));
      } catch (error) {
        await IOUtils.writeUTF8(${JSON.stringify(join(evidence, "failure-"))} + phase + ".json", JSON.stringify({ stage, requests, error: String(error), stack: (error as Error).stack, itemID: item?.id, libraryID: item?.libraryID }));
        throw error;
      } finally {
        Zotero.HTTP.request = originalRequest;
        if (reader) (reader as unknown as _ZoteroTypes.ReaderTab).close();
        if (!preserve) {
          if (item) await item.eraseTx();
          for (const entry of previous) {
            if (entry.value === undefined) clearPref(entry.key);
            else setPref(entry.key, entry.value);
          }
          Services.prefs.savePrefFile(null);
        }
      }
    });
  });
}
`;
await writeFile(wrapper, source, { flag: "wx" });
try {
  const phases = [];
  for (const phase of [1, 2]) {
    const result = spawnSync(
      process.execPath,
      [npm, "test", "--", "--no-watch"],
      {
        cwd: root,
        env: {
          ...process.env,
          CI: "1",
          ZOTERO_READER_RESTART_TEST: evidence,
          ZOTERO_READER_RESTART_PHASE: String(phase),
        },
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    await writeFile(
      join(evidence, `native-${phase}.log`),
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      0,
      `Native restart phase ${phase} failed: ${evidence}`,
    );
    assert.ok(
      result.stdout.includes("Test run completed - 1 passed"),
      `Missing explicit native completion for phase ${phase}`,
    );
    const receipt = JSON.parse(
      await readFile(join(evidence, `phase-${phase}.json`), "utf8"),
    );
    assert.equal(receipt.completed, true);
    const deadline = Date.now() + 15000;
    while (true) {
      try {
        process.kill(receipt.processID, 0);
      } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      const status = await readFile(
        `/proc/${receipt.processID}/stat`,
        "utf8",
      ).catch(() => "");
      if (status.includes(") Z ")) break;
      assert.ok(
        Date.now() < deadline,
        "Previous native Zotero process has not exited",
      );
      await delay(250);
    }
    phases.push(receipt);
    if (phase === 1) {
      await cp(join(root, ".scaffold/test/data"), join(evidence, "data"), {
        recursive: true,
        preserveTimestamps: true,
      });
      await copyFile(
        join(root, ".scaffold/test/profile/prefs.js"),
        join(evidence, "prefs.js"),
      );
    }
  }
  assert.notEqual(
    phases[0].processID,
    phases[1].processID,
    "Verification requires separate native application processes",
  );
  assert.equal(phases[0].requests, 1);
  assert.equal(phases[1].requests, 0);
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      { phases, separateProcesses: true, savedReadWithoutInference: true },
      null,
      2,
    ),
  );
  console.log(`Reader restart regression passed: ${evidence}`);
} finally {
  await rm(wrapper, { force: true });
  console.log(`Reader restart evidence: ${evidence}`);
}
