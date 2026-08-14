import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Select } from '@12-apps/ui/form/Select';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { impersonation } from '../impersonation/surface';

/**
 * The consumer page for `@12-apps/impersonation`.
 *
 * The BANNER is not here: it is mounted once in `shell/harness-shell.tsx`, which
 * is where a real host mounts it and what makes it visible on every other page
 * in this app. The package refuses to start a session in a document with no
 * banner host, so the shell's mount is the precondition and its paint is the
 * proof — a page-level banner would make that guarantee a question of which
 * screen you happened to be on.
 *
 * What IS here is everything a host owns around it: the directory row that
 * opens the start dialog, the tenant-side picker that starts a preview, and a
 * set of probes that call HOST endpoints standing behind the package's write
 * gate. The probes are the only way to see the gate from a browser, and they
 * are deliberately one per rule: an ordinary write, a money write, an
 * allowlisted money read, an unlisted money GET, and an account write.
 */

const StartDialog = impersonation.dialog;

/** The directory rows a desk session can be opened for. */
const PEOPLE = [
  { id: 'patron-1', email: 'lia@harness.dev', label: 'Lia Prado — borrower' },
  { id: 'role-target', email: 'target@harness.dev', label: 'Role Target — staff' },
  {
    id: 'system-2',
    email: 'system2@harness.dev',
    label: 'Robin Sistema — another system librarian',
  },
];

/** The roles this branch has, as the host's own catalog names them. */
const ROLES = ['CLERK', 'CONSERVATOR', 'HEAD_LIBRARIAN'];

const BRANCH_SLUG = 'harness';

/** One probe: a host endpoint behind the gate, and what it answered. */
interface ProbeResult {
  label: string;
  status: number;
  body: string;
}

const PROBES: readonly { label: string; path: string; method: string }[] = [
  { label: 'An ordinary write', path: '/api/catalog-notes', method: 'POST' },
  { label: 'A money write', path: '/api/loans/l-1/renew', method: 'POST' },
  { label: 'An allowlisted money read', path: '/api/loans', method: 'GET' },
  { label: 'An unlisted money GET', path: '/api/loans/l-1/receipt', method: 'GET' },
  { label: "A write to a borrower's own record", path: '/api/borrower-profile', method: 'POST' },
];

function GateProbes(): JSX.Element {
  const [results, setResults] = useState<ProbeResult[]>([]);

  async function run(): Promise<void> {
    const answers = await Promise.all(
      PROBES.map(async (probe) => {
        const response = await fetch(probe.path, {
          method: probe.method,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: probe.method === 'GET' ? undefined : '{}',
        });
        return {
          label: probe.label,
          status: response.status,
          body: await response.text(),
        };
      }),
    );
    setResults(answers);
  }

  return (
    <Stack spacing={1}>
      <Button onClick={() => void run()} dataTestId="probe-run">
        Try every kind of request
      </Button>
      <Box data-testid="probe-results">
        {results.map((result) => (
          <Text
            key={result.label}
            as="p"
            size="xs"
            data-testid={`probe-${result.status}`}
            // The status and the body, so an assertion is a string comparison
            // against the WIRE rather than a screenshot of a screen.
            data-probe-label={result.label}
          >
            {`${result.label}: ${result.status} ${result.body}`}
          </Text>
        ))}
      </Box>
    </Stack>
  );
}

/** The host's own "look as" picker — its roles, its people, its screen. */
function PreviewPicker(): JSX.Element {
  const [role, setRole] = useState(ROLES[0] ?? '');
  const [member, setMember] = useState('role-target');
  const [refusal, setRefusal] = useState<string | null>(null);

  async function start(previewOf: Parameters<typeof impersonation.startPreview>[0]['previewOf']) {
    setRefusal(null);
    try {
      const result = await impersonation.startPreview({
        tenantSlug: BRANCH_SLUG,
        previewOf,
      });
      if (!result.started) setRefusal(result.refusal ?? 'unknown');
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Stack spacing={1}>
      <Select
        size="sm"
        label="Look as a role"
        value={role}
        options={ROLES.map((name) => ({ value: name, label: name }))}
        onChange={(event) => setRole(String(event.target.value))}
        data-testid="preview-role"
      />
      <Button onClick={() => void start({ as: 'role', roleName: role })} dataTestId="preview-role-start">
        Look as this role
      </Button>
      <Select
        size="sm"
        label="Look as a person"
        value={member}
        options={PEOPLE.filter((person) => person.id !== 'system-2').map((person) => ({
          value: person.id,
          label: person.label,
        }))}
        onChange={(event) => setMember(String(event.target.value))}
        data-testid="preview-member"
      />
      <Button
        onClick={() => void start({ as: 'member', memberUserId: member })}
        dataTestId="preview-member-start"
      >
        Look as this person
      </Button>
      {refusal !== null ? (
        <Alert variant="danger" title="Could not start the preview" description={refusal} data-testid="preview-refusal" />
      ) : null}
    </Stack>
  );
}

/** The directory: one row per person, each opening the packaged dialog. */
function Directory(): JSX.Element {
  const [target, setTarget] = useState<(typeof PEOPLE)[number] | null>(null);

  return (
    <Stack spacing={1}>
      {PEOPLE.map((person) => (
        <Button
          key={person.id}
          variant="outline"
          onClick={() => setTarget(person)}
          dataTestId={`impersonate-${person.id}`}
        >
          {person.label}
        </Button>
      ))}
      {target && StartDialog ? (
        <StartDialog
          target={{ id: target.id, email: target.email, name: null }}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </Stack>
  );
}

export function ImpersonationPage(): JSX.Element {
  return (
    <Stack spacing={3} data-testid="impersonation-page">
      <Text variant="heading" size="lg" as="h1">
        Desk sessions
      </Text>
      <Text as="p" size="sm" color="secondary">
        The banner lives in the shell, so it is on every page of this app. Start a
        session here and switch pages to see it follow you.
      </Text>
      <Directory />
      <PreviewPicker />
      <GateProbes />
    </Stack>
  );
}
