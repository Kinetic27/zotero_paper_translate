import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/Kinetic27/zotero_paper_translate/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/Kinetic27/zotero_paper_translate/releases/download/v{{version}}/{{xpiName}}.xpi",

  server: {
    asProxy: false,
  },

  test: {
    hooks: {
      // test/gptApiFormat.test.ts sends its requests to this mock server. It
      // runs in the tester's process, so it stops when the tests exit.
      "test:init": async () => {
        // The scaffold empties its test profile/data before this hook. Restore
        // only this diagnostic's own first-process data for the restart phase.
        const restart = process.env.ZOTERO_READER_RESTART_TEST;
        if (restart && process.env.ZOTERO_READER_RESTART_PHASE === "2") {
          const { cp, copyFile } = await import("node:fs/promises");
          const { basename, dirname, join, resolve } =
            await import("node:path");
          const { tmpdir } = await import("node:os");
          if (
            dirname(resolve(restart)) !== resolve(tmpdir()) ||
            !basename(restart).startsWith("reader-restart-")
          ) {
            throw new Error("Invalid reader restart diagnostic directory.");
          }
          await cp(join(restart, "data"), resolve(".scaffold/test/data"), {
            recursive: true,
            preserveTimestamps: true,
          });
          await copyFile(
            join(restart, "prefs.js"),
            resolve(".scaffold/test/profile/prefs.js"),
          );
        }
        const { startMockLLMServer } =
          await import("./test/mock-llm-server.mjs");
        await startMockLLMServer();
      },
    },
  },

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      addonElementPrefix: `${pkg.config.addonRef.toLowerCase()}-${pkg.version.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: [
          { in: "src/index.ts", out: pkg.config.addonRef },
          { in: "src/extras/*.*", out: "" },
        ],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outdir: "build/addon/chrome/content/scripts",
      },
    ],
  },
});
