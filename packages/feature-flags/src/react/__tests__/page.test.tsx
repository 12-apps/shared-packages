// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlagSummary, GrantView } from "../../index";
import type { FeatureFlagsApiClient } from "../api";
import { createWebFeatureFlags } from "../create-feature-flags";
import { FeatureFlagsError } from "../../index";

const FLAGS: FlagSummary[] = [
  {
    key: "delivery-beta",
    label: "Delivery (beta)",
    description: "Entrega em teste",
    grantCount: 1,
    enabledCount: 1,
  },
  { key: "novo-dashboard", label: "Novo dashboard", description: null, grantCount: 0, enabledCount: 0 },
];

const GRANT: GrantView = {
  userId: "u1",
  email: "dona@example.com",
  name: "Dona da Loja",
  flagKey: "delivery-beta",
  enabled: true,
  note: null,
  grantedBy: "root@12-apps.dev",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

function stubApi(overrides: Partial<FeatureFlagsApiClient> = {}): FeatureFlagsApiClient {
  return {
    listFlags: vi.fn(() => Promise.resolve({ flags: FLAGS, orphans: [] })),
    listGrants: vi.fn(() => Promise.resolve({ items: [GRANT], page: 1, perPage: 20, total: 1 })),
    grantByEmail: vi.fn(() => Promise.resolve({ grant: GRANT })),
    setGrant: vi.fn(() => Promise.resolve({ grant: { ...GRANT, enabled: false } })),
    revoke: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

afterEach(cleanup);

describe("createWebFeatureFlags", () => {
  it("refuses a config without the host api client", () => {
    expect(() => createWebFeatureFlags({ api: undefined as unknown as FeatureFlagsApiClient })).toThrow(
      FeatureFlagsError,
    );
  });

  it("renders the catalog and prompts for a selection", async () => {
    const api = stubApi();
    const { page: Page } = createWebFeatureFlags({ api });
    render(<Page />);
    expect(await screen.findByTestId("ff-flag-delivery-beta")).toBeTruthy();
    expect(screen.getByTestId("ff-select-prompt")).toBeTruthy();
    expect(api.listGrants).not.toHaveBeenCalled();
  });

  it("selecting a flag loads its grants", async () => {
    const api = stubApi();
    const { page: Page } = createWebFeatureFlags({ api });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("ff-flag-delivery-beta"));
    expect(await screen.findByTestId("ff-grant-u1")).toBeTruthy();
    expect(api.listGrants).toHaveBeenCalledWith("delivery-beta", 1);
  });

  it("granting by email posts to the selected flag and refetches", async () => {
    const api = stubApi();
    const { page: Page } = createWebFeatureFlags({ api });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("ff-flag-delivery-beta"));
    await screen.findByTestId("ff-grant-u1");
    fireEvent.change(screen.getByTestId("ff-add-email"), {
      target: { value: "garcom@example.com" },
    });
    fireEvent.click(screen.getByTestId("ff-add-submit"));
    await waitFor(() => {
      expect(api.grantByEmail).toHaveBeenCalledWith("delivery-beta", {
        email: "garcom@example.com",
      });
    });
    // The write bumps the version, so both lists refetch — the cache policy.
    await waitFor(() => {
      expect(vi.mocked(api.listGrants).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("toggle and revoke call the api with the row's identity", async () => {
    const api = stubApi();
    const { page: Page } = createWebFeatureFlags({ api });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("ff-flag-delivery-beta"));
    fireEvent.click(await screen.findByTestId("ff-toggle-u1"));
    await waitFor(() => {
      expect(api.setGrant).toHaveBeenCalledWith("delivery-beta", "u1", { enabled: false });
    });
    fireEvent.click(await screen.findByTestId("ff-revoke-u1"));
    await waitFor(() => {
      expect(api.revoke).toHaveBeenCalledWith("delivery-beta", "u1");
    });
  });

  it("surfaces the api's own message when a load fails", async () => {
    const api = stubApi({
      listFlags: vi.fn(() => Promise.reject(new Error("Não foi possível carregar as concessões"))),
    });
    const { page: Page } = createWebFeatureFlags({ api });
    render(<Page />);
    const alert = await screen.findByTestId("ff-error");
    expect(alert.textContent).toBe("Não foi possível carregar as concessões");
  });

  it("honours host copy overrides", async () => {
    const api = stubApi();
    const { page: Page } = createWebFeatureFlags({
      api,
      copy: { title: "Feature toggles" },
    });
    render(<Page />);
    expect(await screen.findByText("Feature toggles")).toBeTruthy();
  });
});
