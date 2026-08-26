import { useCallback, useEffect, useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Switch } from "@12-apps/ui/form/Switch";
import { Box } from "@12-apps/ui/mui/Box";
import { Heading } from "@12-apps/ui/typography/Heading";
import { Text } from "@12-apps/ui/typography/Text";

import type { EmailAuthSettings } from "../../email-credentials/types";

import type { EmailAuthSettingsCopy } from "./copy";
import type {
  EmailAuthSettingsAudit,
  EmailAuthSettingsClient,
  EmailAuthSettingsPatch,
  EmailAuthSettingsSnapshot,
} from "./client";

/**
 * The platform sign-in switches, as a screen a host mounts.
 *
 * ## Why this is in the package and not in each console
 *
 * The two switches are this package's own feature. `createEmailCredentials`
 * reads them on every call, `readSettings` reports them, and the login screen
 * renders itself from them — so the console that flips them belongs here too.
 * Left to the host it is ~270 lines of toggle plumbing per adopter, and the
 * one that matters most is not the plumbing but the COPY: an operator has to
 * be told what each switch costs, and a host writing that from scratch will
 * write "turns e-mail login off" and stop.
 *
 * ## What stays the host's
 *
 * The words, and the transport. Both arrive through the factory, the same shape
 * `createEmailAuthScreens` uses — one call at module scope, a bound component
 * out, and nothing in the tree below has to know where either came from.
 */
export interface EmailAuthSettingsScreenConfig {
  client: EmailAuthSettingsClient;
  copy: EmailAuthSettingsCopy;
  /**
   * How a timestamp is written. The host's, because a date format is a locale
   * decision and this package refuses to guess one.
   */
  formatWhen: (iso: string) => string;
}

interface ToggleRowProps {
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({
  testId,
  label,
  description,
  checked,
  disabled,
  onChange,
}: ToggleRowProps): JSX.Element {
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 2,
        p: 2,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Text size="md" style={{ fontWeight: 600 }}>
          {label}
        </Text>
        <Text color="secondary" size="sm">
          {description}
        </Text>
      </Box>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={`${testId}-switch`}
        inputProps={{ "aria-label": label }}
      />
    </Box>
  );
}

/** When either switch last changed, and who changed it. */
function AuditLine({
  audit,
  copy,
  formatWhen,
}: {
  audit: EmailAuthSettingsAudit[];
  copy: EmailAuthSettingsCopy;
  formatWhen: (iso: string) => string;
}): JSX.Element | null {
  const latest = audit
    .filter((entry) => entry.updatedAt)
    .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))
    .at(-1);
  if (!latest?.updatedAt) return null;
  return (
    <Text color="secondary" size="xs" as="p" data-testid="auth-settings-audit">
      {/* A platform switch that changed silently is a support incident, so the
          screen that flips them also says who flipped them last. */}
      {copy.lastChanged(formatWhen(latest.updatedAt), latest.updatedBy)}
    </Text>
  );
}

/** What the screen is holding while it renders. */
interface SettingsState {
  snapshot: EmailAuthSettingsSnapshot;
  pending: boolean;
  saveFailed: boolean;
  dismissSaveFailure: () => void;
  apply: (patch: EmailAuthSettingsPatch) => void;
}

/** The two switches and everything around them, once the settings have loaded. */
function SettingsBody({
  state,
  copy,
  formatWhen,
}: {
  state: SettingsState;
  copy: EmailAuthSettingsCopy;
  formatWhen: (iso: string) => string;
}): JSX.Element {
  const settings: EmailAuthSettings = state.snapshot.settings;

  return (
    <Box
      data-testid="page-auth-settings"
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Heading level="h1">{copy.title}</Heading>
        <Text color="secondary" size="sm">
          {copy.intro}
        </Text>
      </Box>

      {state.saveFailed && (
        <Alert
          variant="danger"
          title={copy.saveFailedTitle}
          description={copy.saveFailedDescription}
          closable
          closeLabel={copy.saveFailedDismiss}
          onClose={state.dismissSaveFailure}
          data-testid="auth-settings-error"
        />
      )}

      <ToggleRow
        testId="toggle-email-password"
        label={copy.methodLabel}
        description={copy.methodDescription}
        checked={settings.enabled}
        disabled={state.pending}
        onChange={(enabled) => state.apply({ enabled })}
      />

      <ToggleRow
        testId="toggle-require-verification"
        label={copy.verificationLabel}
        description={copy.verificationDescription}
        checked={settings.requireEmailVerification}
        // Inert while the method is off: a preference stored here would change
        // nothing until somebody else turns the method on.
        disabled={state.pending || !settings.enabled}
        onChange={(requireEmailVerification) => state.apply({ requireEmailVerification })}
      />

      {!settings.enabled && (
        <Text color="secondary" size="xs" as="p">
          {copy.verificationInertNote}
        </Text>
      )}

      <AuditLine audit={state.snapshot.audit} copy={copy} formatWhen={formatWhen} />
    </Box>
  );
}

/** Build the screen. One call, one config object. */
export function createEmailAuthSettingsScreen(
  config: EmailAuthSettingsScreenConfig,
): () => JSX.Element {
  const { client, copy, formatWhen } = config;

  return function EmailAuthSettingsScreen(): JSX.Element {
    const [snapshot, setSnapshot] = useState<EmailAuthSettingsSnapshot | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveFailed, setSaveFailed] = useState(false);
    const [pending, setPending] = useState(false);

    const load = useCallback(async () => {
      setLoadError(null);
      try {
        setSnapshot(await client.read());
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }, []);

    useEffect(() => {
      void load();
    }, [load]);

    const apply = useCallback(async (patch: EmailAuthSettingsPatch) => {
      setSaveFailed(false);
      setPending(true);
      try {
        // The SERVER's answer is written straight back, rather than the
        // optimistic guess: the switch then settles on what actually landed,
        // in one round trip, instead of flicking back on the next read.
        setSnapshot(await client.save(patch));
      } catch {
        setSaveFailed(true);
      } finally {
        setPending(false);
      }
    }, []);

    if (loadError !== null) {
      // `Alert` rather than @12-apps/ui's `ErrorState`: that one pulls in
      // `@mui/icons-material`, whose ESM build re-exports a DIRECTORY
      // (`@mui/material/utils`) that Node refuses to resolve — which takes the
      // whole story suite down, and takes it down in a file that has nothing to
      // do with this screen. The retry lives beside the alert instead.
      return (
        <Box
          data-testid="auth-settings-load-error"
          sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start" }}
        >
          <Alert variant="danger" title={copy.loadFailedTitle} description={loadError} />
          <Button variant="outline" onClick={() => void load()} dataTestId="auth-settings-retry">
            {copy.retry}
          </Button>
        </Box>
      );
    }
    if (!snapshot) return <LoadingState dataTestId="auth-settings-loading" />;

    return (
      <SettingsBody
        state={{
          snapshot,
          pending,
          saveFailed,
          dismissSaveFailure: () => setSaveFailed(false),
          apply: (patch) => void apply(patch),
        }}
        copy={copy}
        formatWhen={formatWhen}
      />
    );
  };
}

/**
 * The platform surface, as the RECORD its area rows name.
 *
 * `authPlatformWebManifest` suggests one route, `auth-settings`, whose screen
 * is `page` — and a screen name is a KEY of the built surface, which is the
 * whole reason a host projecting a route can look the component up instead of
 * guessing at it. `createEmailAuthSettingsScreen` returns the component
 * DIRECTLY, so that lookup found nothing: `surface["page"]` was `undefined`,
 * which a host renders as a blank page with nothing in any log.
 *
 * It survived because the one adopter reads the surface as a component
 * (`settingsSurface as ReturnType<typeof createEmailAuthSettingsScreen>`) and
 * never asked the manifest what its own row said. That works right up until a
 * second host projects areas generically, which is the only way areas are
 * worth carrying at all.
 *
 * So the manifest builds this, and `createEmailAuthSettingsScreen` stays
 * exported unchanged — a host that wants the bare component still calls it.
 */
export function createWebAuthSettings(
  config: EmailAuthSettingsScreenConfig,
): WebAuthSettings {
  return { page: createEmailAuthSettingsScreen(config) };
}

/** What {@link createWebAuthSettings} builds: the console, under its area's name. */
export interface WebAuthSettings {
  page: () => JSX.Element;
}

export type { EmailAuthSettingsCopy } from "./copy";
/** A ready pt-BR pack, still passed by name. See the file for why that is not a default. */
export { PT_BR_SETTINGS } from "./pt-BR";
export { EN_US_SETTINGS } from "./en-US";
export {
  createEmailAuthSettingsClient,
} from "./client";
export type {
  EmailAuthSettingsAudit,
  EmailAuthSettingsClient,
  EmailAuthSettingsPatch,
  EmailAuthSettingsSnapshot,
} from "./client";
