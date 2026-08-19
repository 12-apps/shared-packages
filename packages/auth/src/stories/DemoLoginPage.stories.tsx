import { useState, useSyncExternalStore, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@12-apps/ui/form/Button";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { Text } from "@12-apps/ui/typography/Text";
import { SocialLoginButton, SocialLoginContainer } from "@12-apps/ui/social-login-button";

import { createEmailAuth } from "../react/create-email-auth";
import { createWebAuth } from "../react/create-web-auth";
import { createEmailAuthScreens, type EmailAuthScreens } from "../react/screens";
import { createDemoBackend, type DemoBackend } from "./demo-backend";
import { STORY_COPY } from "./fixtures";

/**
 * THE WHOLE THING, WIRED THE WAY A HOST WIRES IT.
 *
 * Every other story in this folder shows one screen in one state. This one is
 * the assembly: three factories, one page, and the social buttons sitting where
 * they actually sit — above the e-mail form, on the same card.
 *
 * ```ts
 * const auth    = createWebAuth({ basePath: "/api/auth" });
 * const client  = createEmailAuth({ basePath: "/api/auth/email" });
 * const screens = createEmailAuthScreens({ client, copy, useSession: auth.useSession });
 * ```
 *
 * That is the entire integration. Nothing below is a mock of the package: the
 * screens are the published components, the client is the published client, and
 * it is talking HTTP to a backend that happens to live in this page
 * (`demo-backend.ts`). Sign up, click the link in the mailbox, sign in, then
 * add a password to the social account — the flows run for real.
 *
 * ## The Google button, honestly
 *
 * `signIn("google")` is a full-page handoff — the browser leaves for the
 * provider and comes back — which is exactly the difference from
 * `signInWithPassword`, and exactly what a story cannot complete: there is no
 * provider to come back from. So the buttons here sign in through the demo
 * backend instead, and they are rendered to show WHERE the social options live
 * relative to the e-mail form. The live Google round trip is proved elsewhere,
 * against a real Auth.js mount.
 *
 * What this page does prove about Google is the composition: the same
 * `useSession()` drives the social buttons and `signInWithPassword`, so both
 * methods land on one session rather than two.
 */
const meta: Meta = {
  title: "Email auth/Demo login page",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The full integration — createWebAuth + createEmailAuth + " +
          "createEmailAuthScreens — against a backend running in the page, so " +
          "every flow is clickable end to end.",
      },
    },
  },
};
export default meta;

type View = "login" | "signup" | "forgot" | "reset" | "verify" | "account";

interface Demo {
  backend: DemoBackend;
  screens: EmailAuthScreens;
  SessionProvider: (props: { children: React.ReactNode }) => JSX.Element;
  useSession: ReturnType<typeof createWebAuth>["useSession"];
}

/** One demo world: a backend, and the three factories pointed at it. */
function buildDemo(): Demo {
  const backend = createDemoBackend();
  const auth = createWebAuth({ basePath: "/api/auth", fetchImpl: backend.fetchImpl });
  const client = createEmailAuth({
    basePath: "/api/auth/email",
    fetchImpl: backend.fetchImpl,
  });
  const screens = createEmailAuthScreens({
    client,
    copy: STORY_COPY,
    useSession: auth.useSession,
  });
  return { backend, screens, SessionProvider: auth.SessionProvider, useSession: auth.useSession };
}

/** The messages the backend "sent", as clickable links. */
function Mailbox({
  backend,
  onOpen,
}: {
  backend: DemoBackend;
  onOpen: (view: View, token: string) => void;
}): JSX.Element {
  // Subscribed rather than read once: the outbox fills from inside a fetch the
  // screens made, which React has no other way to hear about.
  useSyncExternalStore(backend.subscribe, backend.version, backend.version);
  const messages = [...backend.outbox].reverse();
  return (
    <div
      style={{ border: "1px dashed #999", borderRadius: 8, padding: 12 }}
      data-testid="demo-mailbox"
    >
      <Text size="sm" style={{ fontWeight: 600 }}>
        Mailbox
      </Text>
      <Spacer size="xs" />
      {messages.length === 0 ? (
        <Text color="secondary" size="sm">
          Nothing sent yet. Sign up, or ask for a reset link.
        </Text>
      ) : (
        messages.map((message) => (
          <div key={message.token} style={{ marginBottom: 8 }}>
            <Text size="sm">
              {message.kind === "verification" ? "Confirm your e-mail" : "Reset your password"} —{" "}
              {message.to}
            </Text>
            <Button
              variant="outline"
              color="primary"
              onClick={() =>
                onOpen(message.kind === "verification" ? "verify" : "reset", message.token)
              }
              dataTestId={`open-${message.kind}`}
            >
              Open the link
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

/** The social half of the login card — see the note in the module docblock. */
function SocialBlock({ onPick }: { onPick: (provider: string) => void }): JSX.Element {
  return (
    <>
      <SocialLoginButton provider="google" onClick={() => onPick("google")} />
      <Spacer size="sm" />
      <SocialLoginButton provider="facebook" onClick={() => onPick("facebook")} />
      {/*
        The container's own `showDivider` renders AFTER its children, which puts
        the rule under the whole form rather than between the two ways in. This
        one is placed where it means something.
      */}
      <Spacer size="md" />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
        <Text color="secondary" size="sm">
          or
        </Text>
        <span style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
      </div>
    </>
  );
}

/** Which screen the demo is on, plus the token a mail link carried. */
function useRouter(): {
  view: View;
  token: string | null;
  go: (view: View, token?: string) => void;
} {
  const [view, setView] = useState<View>("login");
  const [token, setToken] = useState<string | null>(null);
  return {
    view,
    token,
    go: (next, nextToken) => {
      setView(next);
      setToken(nextToken ?? null);
    },
  };
}

function DemoBody({ demo, router }: { demo: Demo; router: ReturnType<typeof useRouter> }): JSX.Element {
  const { screens, backend } = demo;
  const { view, token, go } = router;

  if (view === "account") return <screens.PasswordSecurityCard />;
  if (view === "verify") {
    return <screens.VerifyEmailScreen token={token} onContinue={() => go("login")} />;
  }
  if (view === "reset") {
    return (
      <screens.ResetPasswordScreen
        token={token}
        onDone={() => go("login")}
        onRequestNewLink={() => go("forgot")}
      />
    );
  }
  if (view === "forgot") return <screens.ForgotPasswordScreen onBackToLogin={() => go("login")} />;
  if (view === "signup") {
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={() => Promise.resolve()}
        onSignedIn={() => go("account")}
      />
    );
  }
  return (
    <>
      <SocialBlock
        onPick={(provider) => {
          backend.signIn(`${provider}-user@example.com`);
          go("account");
        }}
      />
      <Spacer size="md" />
      <screens.EmailPasswordForm
        callbackUrl="/"
        onSignedIn={() => go("account")}
        onForgotPassword={() => go("forgot")}
      />
    </>
  );
}

function DemoApp({ demo }: { demo: Demo }): JSX.Element {
  const router = useRouter();
  return (
    <Container variant="centered" padding="lg">
      <SocialLoginContainer title="Demo store" showDivider={false}>
        <DemoBody demo={demo} router={router} />
      </SocialLoginContainer>
      <Spacer size="md" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["login", "signup", "account"] as const).map((view) => (
          <Button
            key={view}
            variant="outline"
            color="primary"
            onClick={() => router.go(view)}
            dataTestId={`go-${view}`}
          >
            {view}
          </Button>
        ))}
      </div>
      <Spacer size="md" />
      <Mailbox backend={demo.backend} onOpen={router.go} />
    </Container>
  );
}

/** A fresh world per story, so one story's account cannot leak into another. */
function Demo(): JSX.Element {
  const [demo] = useState(buildDemo);
  return (
    <demo.SessionProvider>
      <DemoApp demo={demo} />
    </demo.SessionProvider>
  );
}

/**
 * The login page as shipped: social buttons, a divider, then the e-mail form.
 *
 * Try it: **signup** → the mailbox holds a confirmation link → open it →
 * **login** with what you chose. Or sign in with Google and then visit
 * **account**, which is the add-a-password card, with no current password
 * demanded because that account never had one.
 */
export const LoginPage: StoryObj = {
  render: () => <Demo />,
};
