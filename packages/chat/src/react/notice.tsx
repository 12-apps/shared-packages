/**
 * The web's send-failure notice: ui's alert, or — in the compact look — an
 * icon and a line of small text on the composer.
 */

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/layout/Box";
import { Text } from "@12-apps/ui/typography/Text";
import type { JSX } from "react";

import type { ChatNoticeProps } from "../ui/thread-view";

export function WebNotice(props: ChatNoticeProps): JSX.Element {
  if (!props.compact) return <Alert variant="danger" description={props.text} testID={props.testID} />;
  return (
    <Box direction="row" gap={0.75} align="start" role="alert" testID={props.testID}>
      <Icon name="WarningAmber" size={16} color={props.tone} />
      <Text variant="caption" color={props.tone}>
        {props.text}
      </Text>
    </Box>
  );
}
