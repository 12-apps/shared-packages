// @vitest-environment jsdom
/**
 * TWO HOSTS, ONE PACKAGE (FUT-1240).
 *
 * The pipeline is the first thing in this package that takes a HOST's own
 * objects — steps, gates, settlement methods — and runs them. That is exactly
 * the seam through which a package starts depending on the one application it
 * was extracted from: a step that "obviously" needs the mode, a gate that
 * "obviously" needs the mesa, and a second adopter that cannot mount any of it.
 *
 * So this suite runs TWO independent hosts side by side in one tree, with
 * different stores, different words and different registered plugins, and
 * asserts that neither can see the other. It also asserts the mechanical half
 * directly: nothing under `flows/pipeline/**` imports a scoped package or
 * reaches outside this package's own source — the property
 * `payments/no-host-imports` enforces repo-wide (`pnpm quality:portability`),
 * pinned here so the suite fails for the right reason rather than the lint
 * lane failing for an unrelated one.
 *
 * Every pixel below renders through the raw-MUI default slots, because this
 * package's dependency graph contains no design system at all.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sliceKey } from "../slices";
import type { AnyCheckoutStep } from "../types";

import { buildHost } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/* eslint-disable test-flakiness/no-unmocked-fs --
   the real source tree IS the subject. Reading it through a fixture would
   assert a property of the fixture and pass forever while the shipped
   directory imported whatever it liked. Reads only, of the working tree. */

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every source file under `flows/pipeline`, tests excluded. */
function pipelineSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") found.push(...pipelineSources(path));
      continue;
    }
    if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** Every module specifier one file imports. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

/** One file's code, with every comment removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A step a host registers, wearing that host's own name. */
function hostStep(id: string, label: string): AnyCheckoutStep {
  return {
    id,
    phase: "details",
    order: -1,
    applies: () => true,
    complete: (ctx) => Boolean((ctx.slices[id] as { done?: boolean } | undefined)?.done),
    slice: {
      initial: () => ({ done: false }),
      persist: "session",
      parse: (raw) =>
        typeof raw === "object" && raw !== null && typeof (raw as { done?: unknown }).done === "boolean"
          ? { done: (raw as { done: boolean }).done }
          : null,
    },
    render: ({ setSlice }) => (
      <button type="button" data-testid={`${id}-continue`} onClick={() => setSlice({ done: true })}>
        {label}
      </button>
    ),
  };
}

describe("the package imports no host", () => {
  it("names no scoped package and reaches outside its own source nowhere", () => {
    const offenders: string[] = [];
    for (const file of pipelineSources(PIPELINE)) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        // A sibling workspace package is a dependency the repo this directory
        // gets lifted into does not have.
        if (/^(@12-apps|@repo)\//.test(specifier)) offenders.push(`${file} → ${specifier}`);
        // `../../..` from `flows/pipeline/*` is still inside `src/`; anything
        // deeper would be leaving the package.
        if (specifier.startsWith("../../../../")) offenders.push(`${file} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches the host only through the config it was handed", () => {
    // No host route, no host query key, no host's own vocabulary. The engine's
    // whole seam is `PaymentFlowsConfig`.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is the rule rather than a
    // convenience: the doc that ARGUES this property has to be able to name
    // the words it is arguing about, and a gate that cannot tell prose from
    // code would make the argument unwritable.
    const forbidden = /\bmesa\b|\bcomanda\b|\bcard[áa]pio\b|\/api\/cart\b|\bServiceMode\b/i;
    const offenders = pipelineSources(PIPELINE).filter((file) =>
      forbidden.test(withoutComments(readFileSync(file, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});

describe("two hosts mount the same engine and cannot see each other", () => {
  it("runs each host's own step, words and store, side by side", async () => {
    const first = buildHost({ steps: [hostStep("schedule", "Agendar")] }, {
      tenantSlug: "loja-a",
      taxIdOnFile: true,
    });
    const second = buildHost({ steps: [hostStep("address", "Endereço")] }, {
      tenantSlug: "loja-b",
      taxIdOnFile: true,
    });
    render(
      <>
        <first.flows.Checkout />
        <second.flows.Checkout />
      </>,
    );

    // Each host's own step is on screen, and neither host's is on the other's.
    expect(await screen.findByTestId("schedule-continue")).toBeTruthy();
    expect(screen.getByTestId("address-continue")).toBeTruthy();

    // Finishing ONE host's step advances that host only.
    fireEvent.click(screen.getByTestId("schedule-continue"));
    await waitFor(() => expect(screen.queryByTestId("schedule-continue")).toBeNull());
    expect(screen.getByTestId("address-continue")).toBeTruthy();

    // And each parked its answer under its OWN store's key.
    expect(window.sessionStorage.getItem(sliceKey("loja-a", "schedule"))).toBe('{"done":true}');
    expect(window.sessionStorage.getItem(sliceKey("loja-b", "address"))).toBeNull();
  });

  it("gives each host its own create port", async () => {
    const first = buildHost({ settlementMethods: [] }, { tenantSlug: "loja-a", taxIdOnFile: true });
    const second = buildHost({ settlementMethods: [] }, { tenantSlug: "loja-b", taxIdOnFile: true });
    render(
      <>
        <first.flows.Checkout />
        <second.flows.Checkout />
      </>,
    );
    const tiles = await screen.findAllByTestId("checkout-method-PIX");
    fireEvent.click(tiles[0] as HTMLElement);
    await waitFor(() => expect(first.createPayable).toHaveBeenCalledTimes(1));
    expect(second.createPayable).not.toHaveBeenCalled();
  });
});
