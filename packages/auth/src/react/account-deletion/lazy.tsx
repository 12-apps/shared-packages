import { createElement, lazy, Suspense, type JSX } from "react";

import type { AccountDeletionSessionHooks, WebAccountDeletion, WebAccountDeletionConfig } from "./index";

/**
 * The deletion screens for `createWebAuth({ accountDeletion })`, loaded when
 * one first renders (FUT-5322).
 *
 * `createWebAuth` is what a host's shell builds for its session, so it sits on
 * every page's first paint. A static import of the screens put their form
 * fields and both copy packs on it for every visitor, though only a person on
 * "Excluir minha conta" ever draws them (measured on the origin host's storefront:
 * +13.7 KiB raw on the eager path). Here the module loads on the first
 * render, once, and both screens share the one build.
 */
export function lazyAccountDeletion(config: WebAccountDeletionConfig, hooks: AccountDeletionSessionHooks): WebAccountDeletion {
  let built: Promise<WebAccountDeletion> | null = null;
  const screens = (): Promise<WebAccountDeletion> =>
    (built ??= import("./index").then((module) => module.createWebAccountDeletion(config, hooks)));
  const Page = lazy(async () => ({ default: (await screens()).DeleteAccountPage }));
  const Pending = lazy(async () => ({ default: (await screens()).PendingDeletionScreen }));
  return {
    DeleteAccountPage: (props): JSX.Element => createElement(Suspense, { fallback: null }, createElement(Page, props)),
    PendingDeletionScreen: (props): JSX.Element => createElement(Suspense, { fallback: null }, createElement(Pending, props)),
  };
}
