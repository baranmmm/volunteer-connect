import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  deleteAuthUser,
  ensureUser,
  signIn,
  storageStateFor,
  type AppRole,
  type Lang,
  type ProfileStatus,
} from "../api/SupabaseClient";
import { cancelEventAs, createEventAs, createSeriesAs, deleteEvents, deleteSeriesData, EVENT_TITLE_PREFIX, type EventSpec, type SeriesSpec } from "../api/events";
import { createTempBranch, deleteRequestsOfUsers, deleteTempBranch } from "../api/eventRequests";
import { FRESH_PREFIX, readSeedState, type BranchName, type RoleKey, type SeedState } from "../data/users";
import { baseUrl, emailDomain, storageFile } from "../setup/env";
import { PROD_REF } from "../setup/guard";
import { Sidebar } from "../pages/components/Sidebar";

export { expect };

/** Use at describe level: `test.use({ storageState: storageFor("managerMedway") })`. */
export const storageFor = (role: Exclude<RoleKey, "disposable">) => storageFile(role);

export type TestUser = { id: string; email: string; fullName: string; branchId: string | null; role: AppRole; status: ProfileStatus };
export type FreshUserOptions = { branch?: BranchName | string; role?: AppRole; status?: ProfileStatus; language?: Lang };

type Fixtures = {
  seed: SeedState;
  /** Creates a confirmed user just for this test (fresh-*@domain); deleted after the test. */
  freshUser: (options?: FreshUserOptions) => Promise<TestUser>;
  /** A new page signed in as a seeded role or a fresh user, with this project's device settings. */
  pageAs: (who: RoleKey | TestUser, options?: { language?: Lang | null }) => Promise<Page>;
  sidebar: Sidebar;
  /**
   * Creates an event as `owner` (a fresh manager) through the app's RPCs; `cancelled: true` publishes then
   * cancels it. The title gets a unique "E2E Event …" prefix. Deleted after the test.
   */
  freshEvent: (owner: TestUser, spec: Omit<EventSpec, "title" | "branchId"> & { label: string; branchId?: string; cancelled?: boolean }) => Promise<{ id: string; title: string }>;
  /** Creates a recurring series as `owner` (create_series); everything sharing its media holder is removed after the test. */
  freshSeries: (owner: TestUser, spec: Omit<SeriesSpec, "title" | "branchId"> & { label: string; branchId?: string }) => Promise<{ seriesId: string; firstEventId: string; mediaEventId: string; count: number; title: string }>;
  /** Registers a series created through the UI (by its media holder id) for cleanup. */
  trackSeries: (mediaEventId: string) => void;
  /** A branch in the seed region just for this test (counts no other test can change); removed afterwards. */
  freshBranch: (label: string) => Promise<string>;
};

/** Fails the test if anything tries to reach the production project; requests are aborted first. */
async function blockProduction(context: BrowserContext, hits: string[]) {
  await context.route(
    (url) => url.hostname.includes(PROD_REF),
    (route) => {
      hits.push(route.request().url());
      return route.abort("blockedbyclient");
    },
  );
}

function deviceOptions(testInfo: TestInfo) {
  const u = testInfo.project.use;
  return {
    baseURL: u.baseURL ?? baseUrl(),
    locale: u.locale ?? "en-GB",
    timezoneId: u.timezoneId ?? "Europe/London",
    ...(u.viewport !== undefined ? { viewport: u.viewport } : {}),
    ...(u.userAgent ? { userAgent: u.userAgent } : {}),
    ...(u.deviceScaleFactor ? { deviceScaleFactor: u.deviceScaleFactor } : {}),
    ...(u.isMobile !== undefined ? { isMobile: u.isMobile } : {}),
    ...(u.hasTouch !== undefined ? { hasTouch: u.hasTouch } : {}),
  };
}

let freshCounter = 0;
const runId = (process.env["E2E_RUN_ID"] || process.env["GITHUB_RUN_ID"] || Date.now().toString(36)).toLowerCase();

export const test = base.extend<Fixtures & { prodHits: string[] }>({
  prodHits: async ({}, use) => {
    const hits: string[] = [];
    await use(hits);
    expect(hits, "The app tried to reach the PRODUCTION Supabase project").toEqual([]);
  },

  context: async ({ context, prodHits }, use) => {
    await blockProduction(context, prodHits);
    await use(context);
  },

  seed: async ({}, use) => {
    await use(readSeedState());
  },

  freshUser: async ({ seed }, use, testInfo) => {
    const created: string[] = [];
    await use(async (options = {}) => {
      const branchId = !options.branch
        ? seed.branches.Medway
        : options.branch in seed.branches
          ? seed.branches[options.branch as BranchName]
          : options.branch;
      const n = ++freshCounter;
      const tag = `${runId}-${testInfo.workerIndex}-${n}-${randomUUID().slice(0, 6)}`;
      const role = options.role ?? "volunteer";
      const status = options.status ?? "active";
      const user = {
        email: `${FRESH_PREFIX}${tag}@${emailDomain()}`,
        fullName: `E2E Fresh ${tag}`,
        branchId,
        role,
        status,
      };
      const id = await ensureUser({ ...user, regionId: seed.regionId, language: options.language ?? "en" }, null);
      created.push(id);
      return { id, ...user };
    });
    // Event requests (and drafts created by approving them) first: deleting a user only nulls its references.
    await deleteRequestsOfUsers(created).catch(() => undefined);
    for (const id of created) await deleteAuthUser(id).catch(() => undefined);
  },

  freshBranch: async ({ seed }, use, testInfo) => {
    const created: string[] = [];
    await use(async (label) => {
      const id = await createTempBranch(seed.regionId, runId, `${testInfo.workerIndex}-${++freshCounter}-${label}`);
      created.push(id);
      return id;
    });
    for (const id of created) await deleteTempBranch(id, seed.branches.Medway).catch(() => undefined);
  },

  pageAs: async ({ browser, seed, prodHits }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (who, options = {}) => {
      const email = typeof who === "string" ? seed.users[who].email : who.email;
      const session = await signIn(email);
      const context = await (browser as Browser).newContext({
        ...deviceOptions(testInfo),
        storageState: storageStateFor(session, new URL(baseUrl()).origin, options.language === undefined ? "en" : options.language),
      });
      await blockProduction(context, prodHits);
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },

  freshEvent: async ({}, use, testInfo) => {
    const created: string[] = [];
    await use(async (owner, spec) => {
      const title = `${EVENT_TITLE_PREFIX}${runId}-${testInfo.workerIndex}-${++freshCounter} ${spec.label}`;
      const id = await createEventAs(owner.email, { ...spec, title, branchId: spec.branchId ?? owner.branchId ?? "" });
      created.push(id);
      if (spec.cancelled) await cancelEventAs(owner.email, id);
      return { id, title };
    });
    await deleteEvents(created).catch(() => undefined);
  },

  trackSeries: async ({}, use) => {
    const holders: string[] = [];
    await use((id) => { holders.push(id); });
    await deleteSeriesData(holders).catch(() => undefined);
  },

  freshSeries: async ({ trackSeries }, use, testInfo) => {
    await use(async (owner, spec) => {
      const title = `${EVENT_TITLE_PREFIX}${runId}-${testInfo.workerIndex}-${++freshCounter} ${spec.label}`;
      const created = await createSeriesAs(owner.email, { ...spec, title, branchId: spec.branchId ?? owner.branchId ?? "" });
      trackSeries(created.mediaEventId);
      return { ...created, title };
    });
  },

  sidebar: async ({ page, isMobile }, use) => {
    await use(new Sidebar(page, !!isMobile));
  },
});

/** Shorthand for toasts emitted through src/lib/toast.ts. */
export const toastSuccess = (page: Page) => page.getByTestId("toast-success");
export const toastError = (page: Page) => page.getByTestId("toast-error");
