// @vitest-environment jsdom
/* eslint-disable test-flakiness/no-test-isolation --
   every `const` the isolation heuristic reads as shared state here is a
   frozen readonly fixture (the fleet's catalog, crew, copy and messages) that
   no case mutates; each case builds its own db and routes from them. The
   audit package's portability suite carries the same disable for the same
   reason. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureFlagsError, type FlagDefinition } from "../index";
import type { FeatureFlagsApiClient } from "../react/api";
import type { FeatureFlagsCopy } from "../react/copy";
import { createWebFeatureFlags } from "../react/create-feature-flags";
import { createApiFeatureFlags } from "../server/index";
import type {
  DirectoryUser,
  FeatureFlagsRequest,
  FeatureFlagsRoute,
  FeatureFlagsServerCopy,
} from "../server/index";

import { fakeDb } from "./fake-db";
import { foreignPatterns, HOST1, HOST2, removedCopyPatterns } from "./foreign-vocabulary";

/**
 * A REAL SECOND HOST, in a domain the extraction origin does not touch — the
 * audit package's arrangement. A portability claim tested against the
 * application the package came out of proves nothing: that application's
 * language is the one that used to be compiled in. So the host below is a
 * **research fleet** — instrument trials, crew, watches — sharing no word
 * with the origin, and "the fixtures themselves" checks that claim against
 * the same ban list the tarball sweep uses rather than restating it.
 *
 * It wires the package the way the README says to: a catalog, a directory, a
 * db seam, and EVERY sentence — the screen's copy and the routes' denials —
 * written by this host. If this suite passes, the machinery presumes no
 * product: no package-supplied flags, no package-supplied language.
 */
const TRIALS: readonly FlagDefinition[] = [
  { key: "sonar-array", label: "Towed sonar array", description: "Hull instrumentation trial" },
  { key: "depth-profiler", label: "Depth profiler" },
];

const CREW: readonly DirectoryUser[] = [
  { id: "crew-7", email: "keeler@tideline.example", name: "Dr. Keeler" },
  { id: "crew-9", email: "moss@tideline.example", name: null },
];

const QUARTERMASTER = "quartermaster@tideline.example";

const FLEET_SERVER_COPY: FeatureFlagsServerCopy = {
  unauthenticated: "State your berth before boarding.",
  unknownFlag: "No such trial aboard this vessel.",
  invalidUser: "Name the crew member.",
  invalidEmail: "That address will not reach anyone at sea.",
  noteTooLong: "The log entry runs past the margin.",
  userNotFound: "No crew member answers to that address.",
  grantNotFound: "That crew member is not on this trial.",
  invalidBody: "The manifest sheet is unreadable.",
  invalidEnabled: "enabled must be true or false.",
};

const FLEET_COPY: FeatureFlagsCopy = {
  title: "Instrument trials",
  subtitle: "Enroll crew into shipboard trials.",
  flagsEmpty: "No trials under way.",
  selectPrompt: "Pick a trial to crew.",
  grantsEmpty: "Nobody is on this trial.",
  loadError: "The tide tables did not answer.",
  addEmailLabel: "Crew address",
  addNoteLabel: "Log entry",
  addSubmit: "Sign aboard",
  adding: "Signing…",
  enable: "Resume",
  disable: "Stand down",
  revoke: "Put ashore",
  statusOn: "Under way",
  statusOff: "Stood down",
  thUser: "Crew",
  thNote: "Log",
  thStatus: "Watch",
  thActions: "Orders",
  grantedByPrefix: "signed by",
  prev: "Astern",
  next: "Ahead",
  pageOf: "Sheet {page} of {pages} — {total} aboard",
  orphansTitle: "Stray signings",
  orphansHint: "Signings whose trial left the roster.",
  tally: "{enabled} of {total} on watch",
};

/** Everything the fleet has to write to adopt the server half. */
function fleetApi(): { routes: FeatureFlagsRoute[] } {
  const { db } = fakeDb();
  return createApiFeatureFlags({
    db: () => Promise.resolve(db),
    catalog: TRIALS,
    directory: {
      getUsers: (ids) => Promise.resolve(CREW.filter((person) => ids.includes(person.id))),
      findUserByEmail: (email) =>
        Promise.resolve(CREW.find((person) => person.email === email) ?? null),
    },
    copy: FLEET_SERVER_COPY,
  });
}

function routeOf(routes: FeatureFlagsRoute[], method: string, path: string): FeatureFlagsRoute {
  const found = routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

function asQuartermaster(partial: Partial<FeatureFlagsRequest> = {}): FeatureFlagsRequest {
  return { actor: { email: QUARTERMASTER }, params: {}, query: {}, ...partial };
}

describe("a host that is not the one this package came from — the routes", () => {
  it("signs a crew member aboard, stamped with the fleet actor", async () => {
    const { routes } = fleetApi();
    const response = await routeOf(routes, "POST", "/:key/grants").handle(
      asQuartermaster({
        params: { key: "sonar-array" },
        body: { email: "keeler@tideline.example", note: "first sea trial" },
      }),
    );
    expect(response.status).toBe(201);
    expect((response.body as { grant: Record<string, unknown> }).grant).toMatchObject({
      userId: "crew-7",
      flagKey: "sonar-array",
      enabled: true,
      grantedBy: QUARTERMASTER,
      note: "first sea trial",
    });
  });

  it("denies with the fleet's words — no package language reaches the bridge", async () => {
    const { routes } = fleetApi();
    const posted = routeOf(routes, "POST", "/:key/grants");

    const blankActor = await posted.handle(asQuartermaster({ actor: { email: " " } }));
    expect(blankActor).toEqual({
      status: 401,
      body: { error: "unauthenticated", message: FLEET_SERVER_COPY.unauthenticated },
    });

    const offRoster = await posted.handle(
      asQuartermaster({ params: { key: "keel-camera" }, body: { email: QUARTERMASTER } }),
    );
    expect(offRoster.body).toEqual({
      error: "unknown_flag",
      message: FLEET_SERVER_COPY.unknownFlag,
    });

    const stranger = await posted.handle(
      asQuartermaster({ params: { key: "sonar-array" }, body: { email: "gull@elsewhere.example" } }),
    );
    expect(stranger.body).toEqual({
      error: "user_not_found",
      message: FLEET_SERVER_COPY.userNotFound,
    });

    const notEnrolled = await routeOf(routes, "PUT", "/:key/grants/:userId").handle(
      asQuartermaster({ params: { key: "sonar-array", userId: "crew-9" }, body: { enabled: false } }),
    );
    expect(notEnrolled.body).toEqual({
      error: "grant_not_found",
      message: FLEET_SERVER_COPY.grantNotFound,
    });
  });

  it("refuses assembly until every denial sentence is written", () => {
    const config = {
      catalog: TRIALS,
      directory: {
        getUsers: () => Promise.resolve([]),
        findUserByEmail: () => Promise.resolve(null),
      },
    };
    expect(() =>
      createApiFeatureFlags({
        ...config,
        db: () => Promise.resolve(fakeDb().db),
        copy: { ...FLEET_SERVER_COPY, userNotFound: "" },
      }),
    ).toThrow(/userNotFound/);
    expect(() =>
      createApiFeatureFlags({
        ...config,
        db: () => Promise.resolve(fakeDb().db),
        copy: undefined as unknown as FeatureFlagsServerCopy,
      }),
    ).toThrow(FeatureFlagsError);
  });
});

describe("a host that is not the one this package came from — the screen", () => {
  afterEach(cleanup);

  function fleetScreenApi(flags: readonly FlagDefinition[] = TRIALS): FeatureFlagsApiClient {
    const summaries = flags.map((trial) => ({
      key: trial.key,
      label: trial.label,
      description: trial.description ?? null,
      grantCount: 0,
      enabledCount: 0,
    }));
    const unused = (): Promise<never> => Promise.reject(new Error("not under test"));
    return {
      listFlags: () => Promise.resolve({ flags: summaries, orphans: [] }),
      listGrants: () => Promise.resolve({ items: [], page: 1, perPage: 20, total: 0 }),
      grantByEmail: unused,
      setGrant: unused,
      revoke: unused,
    };
  }

  it("renders the fleet's sentences and nobody else's", async () => {
    const { page: Page } = createWebFeatureFlags({ api: fleetScreenApi(), copy: FLEET_COPY });
    render(<Page />);
    // The wait is anchored on the FLAG ROW, which is the only thing here that
    // needs the catalog load. The title and subtitle are static header copy
    // rendered on mount, so awaiting one of THOSE resolves on the very first
    // render and leaves the synchronous queries below racing the load — the
    // row is then absent for a reason that has nothing to do with portability.
    // Same anchoring as the empty-state case underneath, for the same reason.
    expect((await screen.findByTestId("ff-flag-sonar-array")).textContent).toContain(
      "Towed sonar array",
    );
    expect(screen.getByText(FLEET_COPY.title)).toBeTruthy();
    expect(screen.getByText(FLEET_COPY.subtitle)).toBeTruthy();
    expect(screen.getByTestId("ff-select-prompt").textContent).toBe(FLEET_COPY.selectPrompt);
  });

  it("renders the fleet's empty state when no trial is under way", async () => {
    const { page: Page } = createWebFeatureFlags({ api: fleetScreenApi([]), copy: FLEET_COPY });
    render(<Page />);
    expect((await screen.findByTestId("ff-flags-empty")).textContent).toBe(FLEET_COPY.flagsEmpty);
  });

});

describe("the fixtures themselves", () => {
  /**
   * The anti-vacuity guard for the SUITE above: a portability proof written
   * in the extraction origin's own words proves nothing, and would look
   * identical to this file. Checked against the IMPORTED ban lists — never a
   * restated copy, which is two statements of a set that can drift.
   */
  it("share no word with the application this package was extracted for", () => {
    const fixtureWords = [
      ...TRIALS.flatMap((trial) => [
        trial.key,
        trial.label,
        ...(trial.description === undefined ? [] : [trial.description]),
      ]),
      ...CREW.flatMap((person) => [
        person.id,
        person.email,
        ...(person.name === null ? [] : [person.name]),
      ]),
      QUARTERMASTER,
      ...Object.values(FLEET_SERVER_COPY),
      ...Object.values(FLEET_COPY),
    ];

    const bans = [...foreignPatterns(), ...removedCopyPatterns()];
    for (const word of fixtureWords) {
      expect(bans.filter(({ pattern }) => new RegExp(pattern.source, "i").test(word))).toEqual([]);
    }

    // Anti-vacuity for the guard itself: a loop over an empty list passes…
    expect(fixtureWords.length).toBeGreaterThan(40);
    // …and the list it checks against is the real one, with entries a
    // hand-written copy would have dropped.
    expect(bans.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["R$", `${HOST1}-${HOST2}`, "usuário", "FUT-<n>", "comanda", "Página"]),
    );
    const oldDefault = "Conceda um recurso em teste a um testador — Página 1";
    expect(bans.some(({ pattern }) => new RegExp(pattern.source, "i").test(oldDefault))).toBe(true);
  });
});
