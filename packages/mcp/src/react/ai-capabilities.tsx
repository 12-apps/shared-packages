import { Box } from "@12-apps/ui/mui/Box";
import { Text } from "@12-apps/ui/typography/Text";

import { AI_CAPABILITIES, type AiCapability } from "../guide";
import { CapabilityIcon } from "./ai-icons";

/** One marketing card: an icon, a headline and an example prompt (as a bubble). */
function CapabilityCard({ capability }: { capability: AiCapability }): React.JSX.Element {
  return (
    <Box
      data-testid={`ai-capability-${capability.id}`}
      sx={{
        p: 2.5,
        borderRadius: 3,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        height: "100%",
        // Static transition string: safe to cross the server→client boundary.
        transition: "border-color 200ms, box-shadow 200ms, transform 200ms",
        "&:hover": { borderColor: "primary.main", boxShadow: 3, transform: "translateY(-3px)" },
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          mb: 1.5,
        }}
      >
        <CapabilityIcon id={capability.id} fontSize={26} />
      </Box>
      <Text variant="body" weight="bold" as="h3">
        {capability.title}
      </Text>
      <Box
        data-testid={`ai-capability-prompt-${capability.id}`}
        sx={{
          mt: 1,
          px: 1.5,
          py: 1,
          borderRadius: 2,
          borderBottomLeftRadius: 4,
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
        }}
      >
        <Text variant="body" size="sm" as="p" color="secondary">
          {capability.detail}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Marketing block for the AI integration: a headline + a responsive grid of
 * capability cards. Shown on the onboarding landing (before the owner starts) to
 * sell the feature — "here's what the assistant does for you". `capabilities`
 * defaults to the shared set; apps can pass their own.
 */
export function AiCapabilities({
  capabilities = AI_CAPABILITIES,
}: {
  capabilities?: readonly AiCapability[];
}): React.JSX.Element {
  return (
    <Box data-testid="ai-capability-examples" sx={{ width: "100%" }}>
      <Box sx={{ mb: 3 }}>
        <Text variant="heading" size="sm" as="h2">
          O que o assistente faz por você
        </Text>
        <Box sx={{ mt: 0.5 }}>
          <Text variant="body" size="sm" as="p" color="secondary">
            Sem planilhas, sem cliques — é só perguntar na conversa.
          </Text>
        </Box>
      </Box>
      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
        }}
      >
        {capabilities.map((capability) => (
          <CapabilityCard key={capability.id} capability={capability} />
        ))}
      </Box>
    </Box>
  );
}
