# NotificationStatusNotice Test Status Tracking

## Test Files Status

- [x] NotificationStatusNotice.test.stories.tsx created
- [x] Unit tests: `__tests__/notification-status-notice.test.tsx`, `detect-notification-browser.test.ts`, `notification-unblock-steps.test.ts`

## Storybook Tests Status

| Test Name | Status | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Disabled: the action asks the host | Written | - | role/status, onEnable called once |
| Blocked: steps open and close from the keyboard | Written | - | Enter opens, Space closes, aria-expanded, order |
| Enabled and unavailable: no action | Written | - | no button rendered |
| Disabled + pending: the action is locked | Written | - | action disabled |

Legend: Pending | Running | PASS | FAIL

## Static Stories Status

- [x] Default story (`Disabled`)
- [x] All variants covered (`Enabled`, `Disabled`, `Blocked`, `Unavailable`, `AllStatuses`)
- [x] Loading state story (`Pending`)
- [x] Edge cases (`LongText`, `BlockedOnIphone`)
