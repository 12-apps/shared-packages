import type { Meta, StoryObj } from "@storybook/react-vite";

import type {
  ConnectApplicationReport,
  ConnectApplicationStatus,
  HomologacaoGuide,
} from "@12-apps/payments-backend";

import { ConnectApplicationPanel } from "../components/platform/ConnectApplicationPanel";
import { PlatformHomologacao } from "../components/platform/PlatformHomologacao";
import type { PlatformHomologationRecordView } from "../components/platform/HomologacaoOutcomeCard";

/**
 * The PLATFORM operations screens (FUT-479 / FUT-483, packaged by FUT-573):
 * the Connect-application consult and the homologação, each in the states an
 * operator actually meets. Everything arrives via props — no transport, no
 * mount — so these stories double as the components' contract: what a host
 * passes is exactly what these fixtures spell out.
 */
const meta: Meta = {
  title: "Platform/Operations",
  parameters: {
    docs: {
      description: {
        component:
          "The platform-side screens: the Connect application per environment with the " +
          "redirect-URI verdict (mismatch / match / unknown), and the homologação with its " +
          "outcome record, paste-ready answers and evidence generator.",
      },
    },
  },
};
export default meta;

const EXPECTED = "https://app.example.com/api/payments/oauth/callback/pagbank";

function envStatus(over: Partial<ConnectApplicationStatus>): ConnectApplicationStatus {
  return {
    environment: "SANDBOX",
    configured: false,
    clientId: null,
    application: null,
    redirectUriMismatch: null,
    error: null,
    ...over,
  };
}

const REGISTERED = {
  name: "Aurora Plataforma",
  description: "Pedidos online",
  site: "https://app.example.com",
  redirectUri: EXPECTED,
  logo: null,
  extra: { created_at: "2026-01-01", scope: "payments.read payments.create" },
};

function connectReport(environments: ConnectApplicationStatus[]): ConnectApplicationReport {
  return { provider: "pagbank", expectedRedirectUri: EXPECTED, environments };
}

const CONFIG_VARS = ["PLATFORM_OAUTH_CLIENT_ID", "PLATFORM_OAUTH_CLIENT_SECRET", "PLATFORM_TOKEN"];

export const ConnectApplicationAllVerdicts: StoryObj = {
  name: "Aplicação Connect — os três veredictos",
  render: () => (
    <ConnectApplicationPanel
      report={connectReport([
        envStatus({
          environment: "SANDBOX",
          configured: true,
          clientId: "app-sandbox-123",
          application: { ...REGISTERED, redirectUri: `${EXPECTED}/` },
          redirectUriMismatch: true,
        }),
        envStatus({
          environment: "PRODUCTION",
          configured: true,
          clientId: "app-prod-456",
          application: REGISTERED,
          redirectUriMismatch: false,
        }),
      ])}
      onRefresh={() => undefined}
      configVarsFor={() => CONFIG_VARS}
    />
  ),
};

export const ConnectApplicationUnconfigured: StoryObj = {
  name: "Aplicação Connect — nada configurado",
  render: () => (
    <ConnectApplicationPanel
      report={connectReport([
        envStatus({ environment: "SANDBOX" }),
        envStatus({ environment: "PRODUCTION" }),
      ])}
      onRefresh={() => undefined}
    />
  ),
};

export const ConnectApplicationDegraded: StoryObj = {
  name: "Aplicação Connect — consulta falhou / sem redirect_uri",
  render: () => (
    <ConnectApplicationPanel
      report={connectReport([
        envStatus({
          environment: "SANDBOX",
          configured: true,
          clientId: "app-sandbox-123",
          error: "O PagBank respondeu 403 ao consultar a aplicação",
        }),
        envStatus({
          environment: "PRODUCTION",
          configured: true,
          clientId: "app-prod-456",
          application: { ...REGISTERED, redirectUri: null },
          redirectUriMismatch: null,
        }),
      ])}
      onRefresh={() => undefined}
    />
  ),
};

const GUIDE: HomologacaoGuide = {
  formUrl: "https://app.pipefy.com/public/form/2e56YZLK",
  supportFormUrl: "https://app.pipefy.com/public/form/sBlh9Nq6",
  docsUrl: "https://developer.pagbank.com.br/docs/solicitar-homologacao",
  exampleUrl: "https://dev.pagbank.uol.com.br/reference/criar-pagar-pedido-com-cartao",
  integrationType: "Desenvolvimento próprio",
  services: ["API de Pedidos e Pagamentos (Order)", "API Connect"],
  accessInstructions:
    "Acesse https://app.example.com/demo-balcao/menu. Clique em Entrar e faça login com uma " +
    "conta Google. Adicione produtos ao carrinho e finalize o pedido escolhendo PIX ou cartão.",
  siteUrl: "https://app.example.com",
  demoStoreUrl: "https://app.example.com/demo-balcao/menu",
  productsDescription:
    "Plataforma Aurora de cardápio digital e pedidos online (multi-loja), com pagamento via " +
    "PIX e cartão de crédito.",
  slaText:
    "Prazo (SLA): até 4 dias úteis quando os registros são enviados corretamente; " +
    "estendido caso contrário.",
};

const APPROVED: PlatformHomologationRecordView = {
  provider: "pagbank",
  status: "APPROVED",
  protocol: "PIPE-2026-081",
  notes: "Aprovada na primeira análise.",
  submittedAt: "2026-08-01T13:00:00.000Z",
  decidedAt: "2026-08-05T09:30:00.000Z",
  updatedBy: "ops@example.com",
  updatedAt: "2026-08-05T09:30:00.000Z",
};

const IDLE = { pending: false, error: null, success: false };

export const HomologacaoNeverRequested: StoryObj = {
  name: "Homologação — não solicitada",
  render: () => (
    <PlatformHomologacao
      record={null}
      guide={GUIDE}
      onSaveRecord={() => undefined}
      save={IDLE}
      onGenerateAnexo={async () => {
        throw new Error(
          "Falta o token de sandbox da plataforma: salve-o no painel de cobrança e gere novamente.",
        );
      }}
    />
  ),
};

export const HomologacaoApproved: StoryObj = {
  name: "Homologação — aprovada",
  render: () => (
    <PlatformHomologacao
      record={APPROVED}
      guide={GUIDE}
      onSaveRecord={() => undefined}
      save={{ pending: false, error: null, success: true }}
      onGenerateAnexo={async () => undefined}
    />
  ),
};

export const HomologacaoRejected: StoryObj = {
  name: "Homologação — recusada, com o motivo registrado",
  render: () => (
    <PlatformHomologacao
      record={{
        ...APPROVED,
        status: "REJECTED",
        decidedAt: "2026-08-06T16:00:00.000Z",
        notes: "Faltou o anexo de evidências; reenviar com o arquivo gerado.",
      }}
      guide={GUIDE}
      onSaveRecord={() => undefined}
      save={IDLE}
      onGenerateAnexo={async () => undefined}
    />
  ),
};
