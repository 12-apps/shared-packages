import { InstallPrompt, usePwaInstall } from '@12-apps/ui/utility/InstallPrompt';

/**
 * The published install prompt, mounted the way a storefront mounts it.
 *
 * This page exists because the defect it guards is invisible to every other
 * kind of test. `beforeinstallprompt` fires once, during page load, before
 * this module has been evaluated; a component that waits for its own effect to
 * attach a listener never hears it and reports "cannot install" forever, on
 * the one platform that can. jsdom cannot express that ordering because there
 * is no page load to be early or late relative to, and a Storybook story
 * mounts before anything is dispatched, which is the comfortable ordering that
 * never occurs.
 *
 * Here the event can be fired by the spec BEFORE the bundle runs, against the
 * PUBLISHED tarball, in a real Chromium. That is the whole point of putting it
 * in the harness rather than beside the component.
 *
 * The state panel is rendered so a failure says which precondition was missing
 * rather than only "the prompt is not visible" — the distinction between "the
 * browser never offered" and "the offer was dropped" is the entire bug.
 */
export function PwaInstallPromptPage() {
  const { canInstall, platform, isInstalled } = usePwaInstall({
    storageKey: 'harness-install-dismissed',
  });

  const stash = (
    window as unknown as {
      __pwaInstall?: { event: unknown; firedAt: number | null; installedAt: number | null };
    }
  ).__pwaInstall;

  return (
    <section data-testid="pwa-install-prompt-page">
      <h2>Install prompt</h2>

      <InstallPrompt
        storageKey="harness-install-dismissed"
        title="Install this app"
        description="Add it to your home screen to open it faster next time."
        installLabel="Install"
        dismissLabel="Not now"
      />

      {/* Read by the spec, so a red test names the precondition that failed. */}
      <dl data-testid="pwa-install-state" style={{ marginTop: 24, fontSize: 13 }}>
        <dt>canInstall</dt>
        <dd data-testid="state-can-install">{String(canInstall)}</dd>
        <dt>platform</dt>
        <dd data-testid="state-platform">{platform}</dd>
        <dt>isInstalled</dt>
        <dd data-testid="state-is-installed">{String(isInstalled)}</dd>
        <dt>capture ran</dt>
        <dd data-testid="state-capture-present">{String(stash !== undefined)}</dd>
        <dt>event held</dt>
        <dd data-testid="state-event-held">{String(Boolean(stash?.event))}</dd>
      </dl>
    </section>
  );
}
