import { getPref, setPref } from "../utils/prefs";
import { createCodexBrowserLogin } from "./codexOAuth";
import {
  loadCodexCredentials,
  saveCodexCredentials,
  clearCodexCredentials,
  type CodexCredentials,
} from "./codexCredentials";
import {
  CodexHTTPError,
  exchangeCodexCode,
  refreshCodexCredentials,
  getCodexModels,
  requestCodexTranslation,
  type CodexModel,
} from "./codexHttp";

export type CodexAuthState = "signed-out" | "signing-in" | "signed-in";

type Operation<T> = { controller: AbortController; promise: Promise<T> };
let epoch = 0;
let quitting = false;
let stopping: Promise<void> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();
const controllers = new Set<AbortController>();
const pending = new Set<Promise<unknown>>();
let login: Operation<void> | undefined;
let loginMessage = "";
let refresh: Promise<CodexCredentials> | undefined;
let catalog:
  | { accountId: string; expires: number; models: CodexModel[] }
  | undefined;
let removeQuitBlocker: (() => void) | undefined;
const authListeners = new Set<() => void>();

function notifyCodexAuthState() {
  // Application shutdown aborts pending work; UI listeners must not delay or
  // observe that internal teardown as an auth transition.
  if (quitting) return;
  for (const listener of [...authListeners]) {
    try {
      listener();
    } catch (error) {
      // A UI listener failure must not affect credential persistence or OAuth.
      try {
        const detail = error instanceof Error ? error.message : String(error);
        Zotero.debug(`[Codex] auth state listener failed: ${detail}`);
      } catch {
        // Logging must never break notification.
      }
    }
  }
}

export function subscribeCodexAuthState(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

export async function getCodexAuthState(
  signal?: AbortSignal,
): Promise<CodexAuthState> {
  return owned<CodexAuthState>(async (active, generation) => {
    if (login) return "signing-in";
    const stored = await loadCodexCredentials();
    check(active, generation);
    if (login) return "signing-in";
    return stored ? "signed-in" : "signed-out";
  }, signal).promise;
}

async function onApplicationQuit() {
  quitting = true;
  await shutdownCodex();
}
function registerQuitBlocker() {
  if (removeQuitBlocker) return;
  const { AsyncShutdown } = ChromeUtils.importESModule(
    "resource://gre/modules/AsyncShutdown.sys.mjs",
  );
  AsyncShutdown.quitApplicationGranted.addBlocker(
    "Zotero Translation Reader: stop OAuth requests",
    onApplicationQuit,
  );
  removeQuitBlocker = () =>
    AsyncShutdown.quitApplicationGranted.removeBlocker(onApplicationQuit);
}
function releaseQuitBlocker(barrier: Promise<void>) {
  // A replacement login or logout may have extended the barrier while this
  // drain was pending. Never unregister a newer owner's protection.
  if (quitting || stopping !== barrier || pending.size !== 0) return;
  const remove = removeQuitBlocker;
  removeQuitBlocker = undefined;
  remove?.();
}
function invalidateAccount() {
  catalog = undefined;
  setPref("codex.accountRevision", Zotero.Utilities.randomString(24));
}
function check(signal: AbortSignal, generation: number) {
  if (signal.aborted || generation !== epoch || quitting)
    throw new Error("ChatGPT operation cancelled.");
}
function owned<T>(
  run: (signal: AbortSignal, generation: number) => Promise<T>,
  external?: AbortSignal,
): Operation<T> {
  const controller = new AbortController();
  const generation = epoch;
  const gate = stopping;
  const abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted || quitting) controller.abort();
  controllers.add(controller);
  const promise = Promise.resolve()
    .then(async () => {
      await gate;
      check(controller.signal, generation);
      registerQuitBlocker();
      return run(controller.signal, generation);
    })
    .finally(() => {
      external?.removeEventListener("abort", abort);
      controllers.delete(controller);
      pending.delete(promise);
    });
  pending.add(promise);
  return { controller, promise };
}

export async function shutdownCodex(): Promise<void> {
  ++epoch;
  catalog = undefined;
  for (const controller of controllers) controller.abort();
  const old = [...pending];
  const drain = Promise.allSettled([stopping, ...old]).then(() => undefined);
  stopping = drain;
  await drain;
  releaseQuitBlocker(drain);
}

async function credentials(
  signal: AbortSignal,
  generation: number,
  rejectedAccess?: string,
): Promise<CodexCredentials> {
  const stored = await loadCodexCredentials();
  check(signal, generation);
  if (!stored)
    throw new Error(
      "Sign in with ChatGPT in the service settings before translating.",
    );
  if (stored.expires > Date.now() + 60_000 && stored.access !== rejectedAccess)
    return stored;
  if (!refresh) {
    const job = owned(async (refreshSignal, refreshGeneration) => {
      const latest = await loadCodexCredentials();
      check(refreshSignal, refreshGeneration);
      if (!latest) throw new Error("Sign in with ChatGPT again.");
      if (
        latest.expires > Date.now() + 60_000 &&
        latest.access !== rejectedAccess
      )
        return latest;
      const updated = await refreshCodexCredentials(latest, refreshSignal);
      if (updated.accountId !== latest.accountId)
        throw new Error(
          "The ChatGPT account changed during refresh. Sign in again.",
        );
      // Logout awaits this operation before clearing storage, so a rotated token
      // cannot be written back after logout. Preserve successful refresh rotation.
      await saveCodexCredentials(updated);
      check(refreshSignal, refreshGeneration);
      return updated;
    });
    const tracked = job.promise.finally(() => {
      if (refresh === tracked) refresh = undefined;
    });
    refresh = tracked;
  }
  // A page may stop waiting without aborting a refresh another consumer needs.
  // The refresh itself remains owned until rotation has been persisted.
  let abortWait!: () => void;
  const cancelledWait = new Promise<never>((_resolve, reject) => {
    abortWait = () => reject(new Error("ChatGPT operation cancelled."));
    signal.addEventListener("abort", abortWait, { once: true });
    if (signal.aborted) abortWait();
  });
  try {
    const result = await Promise.race([refresh, cancelledWait]);
    check(signal, generation);
    return result;
  } finally {
    signal.removeEventListener("abort", abortWait);
  }
}
async function authorized<T>(
  signal: AbortSignal,
  generation: number,
  run: (value: CodexCredentials) => Promise<T>,
): Promise<T> {
  const current = await credentials(signal, generation);
  try {
    const result = await run(current);
    check(signal, generation);
    return result;
  } catch (error) {
    check(signal, generation);
    if (!(error instanceof CodexHTTPError) || error.status !== 401) throw error;
    const updated = await credentials(signal, generation, current.access);
    const result = await run(updated);
    check(signal, generation);
    return result;
  }
}
export async function getCodexModelCatalog(
  signal?: AbortSignal,
): Promise<CodexModel[]> {
  if (login) return [];
  return owned(async (active, generation) => {
    if (login) return [];
    const stored = await loadCodexCredentials();
    check(active, generation);
    if (!stored || login) return [];
    return availableModels(active, generation);
  }, signal).promise;
}
async function availableModels(
  signal: AbortSignal,
  generation: number,
  force = false,
): Promise<CodexModel[]> {
  return authorized(signal, generation, async (current) => {
    if (
      !force &&
      catalog?.accountId === current.accountId &&
      catalog.expires > Date.now()
    )
      return catalog.models;
    const models = await getCodexModels(current, signal);
    check(signal, generation);
    catalog = {
      accountId: current.accountId,
      expires: Date.now() + 5 * 60_000,
      models,
    };
    return models;
  });
}

export async function loginCodex(): Promise<string> {
  if (quitting) throw new Error("Zotero is closing.");
  const stop = shutdownCodex();
  invalidateAccount();
  let readyResolve!: (message: string) => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  loginMessage = "Browser sign-in is starting.";
  const operation = owned(async (signal, generation) => {
    await stop;
    check(signal, generation);
    const previous = await loadCodexCredentials();
    check(signal, generation);
    const flow = await createCodexBrowserLogin(signal);
    let wrote = false;
    try {
      check(signal, generation);
      loginMessage = "Complete ChatGPT sign-in in your browser.";
      try {
        Zotero.launchURL(flow.authUrl);
      } catch {
        throw new Error("Could not open the browser. Retry ChatGPT sign-in.");
      }
      readyResolve("Complete ChatGPT sign-in in your browser.");
      const result = await flow.result;
      check(signal, generation);
      loginMessage = "Finishing ChatGPT sign-in.";
      const value = await exchangeCodexCode(
        result.code,
        result.verifier,
        signal,
      );
      check(signal, generation);
      await saveCodexCredentials(value);
      wrote = true;
      check(signal, generation);
      invalidateAccount();
      loginMessage = "ChatGPT sign-in completed.";
    } catch (error) {
      // Native encrypted writes cannot be interrupted. If cancellation won while
      // the write was pending, restore the preceding account before settling.
      if (wrote && (signal.aborted || generation !== epoch)) {
        if (previous) await saveCodexCredentials(previous);
        else await clearCodexCredentials();
      }
      throw error;
    } finally {
      flow.close();
    }
  });
  login = operation;
  notifyCodexAuthState();
  void operation.promise.then(
    () => {
      if (login === operation) {
        login = undefined;
        notifyCodexAuthState();
      }
    },
    (error) => {
      if (login === operation) {
        login = undefined;
        loginMessage = operation.controller.signal.aborted
          ? "ChatGPT sign-in cancelled."
          : error instanceof Error
            ? error.message
            : "ChatGPT sign-in failed. Retry sign-in.";
        notifyCodexAuthState();
      }
      readyReject(error);
    },
  );
  return ready;
}
export async function cancelCodexLogin(): Promise<string> {
  const current = login;
  if (!current) return "No sign-in is pending.";
  current.controller.abort();
  await current.promise.catch(() => undefined);
  return "ChatGPT sign-in cancelled.";
}
export async function logoutCodex(): Promise<string> {
  if (quitting) throw new Error("Zotero is closing.");
  registerQuitBlocker();
  const stop = shutdownCodex();
  const message =
    "Signed out of this plugin. Other applications' ChatGPT sessions are unchanged.";
  const clearing = stop.then(async () => {
    await clearCodexCredentials();
    invalidateAccount();
    if (!login) loginMessage = message;
    notifyCodexAuthState();
  });
  const drain = clearing.catch(() => undefined);
  stopping = drain;
  try {
    await clearing;
  } finally {
    releaseQuitBlocker(drain);
  }
  return message;
}
export async function getCodexStatus(): Promise<string> {
  if (login) return loginMessage;
  return owned(async (signal, generation) => {
    const stored = await loadCodexCredentials();
    check(signal, generation);
    if (!stored)
      return `${loginMessage || "Not signed in."} Use Sign in with ChatGPT.`;
    const models = await availableModels(signal, generation, true);
    const current = await loadCodexCredentials();
    check(signal, generation);
    if (!current) throw new Error("Sign in with ChatGPT again.");
    return `Signed in with ChatGPT${current.email ? `: ${current.email}` : ""}\nModels: ${models.map((model) => model.id).join(", ")}\nDirect OAuth connection. No local Codex process or model tools. Account Codex access and usage limits apply.`;
  }).promise;
}
export function translateWithCodex(
  raw: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<string> {
  const generation = epoch;
  const result = queue.then(() => {
    if (generation !== epoch || signal?.aborted)
      throw new Error("ChatGPT operation cancelled.");
    if (login)
      throw new Error("Complete or cancel ChatGPT sign-in before translating.");
    return owned(async (active, current) => {
      const models = await availableModels(active, current);
      const selected = String(getPref("codex.model") || "").trim();
      const model = selected
        ? models.find((entry) => entry.id === selected)
        : models[0];
      if (!model)
        throw new Error(
          "The selected model is unavailable. Check account and models in service settings.",
        );
      const selectedEffort = String(
        getPref("codex.reasoningEffort") || "",
      ).trim();
      if (selectedEffort && !model.reasoningEfforts.includes(selectedEffort))
        throw new Error(
          "The selected reasoning effort is unavailable for this model. Choose a supported effort in service settings.",
        );
      return authorized(active, current, (value) =>
        requestCodexTranslation(
          value,
          model.id,
          raw,
          from,
          to,
          selectedEffort || undefined,
          active,
        ),
      );
    }, signal).promise;
  });
  queue = result.catch(() => undefined);
  return result;
}
