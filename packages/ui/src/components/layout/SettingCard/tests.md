# SettingCard family Test Status Tracking

`SettingCard`, `SettingToggle`, `SettingGroup` and `SettingGrid` share this
folder and this file.

## Test Files Status

- [x] SettingCard.test.stories.tsx, SettingToggle.test.stories.tsx, SettingGroup.test.stories.tsx, SettingGrid.test.stories.tsx created
- [x] `__tests__/` Vitest suites for all four
- [x] Core categories implemented (interaction, keyboard, screen reader, focus, responsive/layout, visual states, edge cases)

## Storybook Tests Status

### Test Results

| Test Name                                   | Status | Pass/Fail | Notes                                                  |
| ------------------------------------------- | ------ | --------- | ------------------------------------------------------ |
| SettingCard › Opens in place                | PASS   | Pass      | form inside the same card; no dialog                   |
| SettingCard › Focus round trip              | PASS   | Pass      | first field on open, Edit on close                     |
| SettingCard › Keyboard only                 | PASS   | Pass      | Tab to Edit, Enter opens, Escape cancels               |
| SettingCard › Save resolves                 | PASS   | Pass      | "Saving…", `aria-busy`, then new summary + focus       |
| SettingCard › Save rejects                  | PASS   | Pass      | stays open, draft intact, focus stays on Save          |
| SettingCard › Cancel discards               | PASS   | Pass      | reopened form shows the saved value                    |
| SettingCard › Accessible names              | PASS   | Pass      | region, heading, "Edit <title>"                        |
| SettingCard › Learn more disclosure         | PASS   | Pass      | `aria-expanded` toggles, content visible               |
| SettingToggle › Flip saves                  | PASS   | Pass      | optimistic value, busy but enabled, then settles       |
| SettingToggle › Reject reverts              | PASS   | Pass      | back to saved value, error shown                       |
| SettingToggle › Keyboard flip               | PASS   | Pass      | Space flips; focus stays on the switch while saving    |
| SettingToggle › Label is the tap target     | PASS   | Pass      | clicking the title flips                               |
| SettingGroup › Off dims and disables        | PASS   | Pass      | rows rendered, `inert`, opacity < 1, hint shown        |
| SettingGroup › Off rows skipped by Tab      | PASS   | Pass      | focus never enters the inert rows                      |
| SettingGroup › Turn on activates            | PASS   | Pass      | rows live, hint gone, fields accept input              |
| SettingGrid › Columns follow the container  | PASS   | Pass      | 1 / 2 / 3 columns at 360 / 720 / 1080 px containers    |
| SettingGrid › Rows share height             | PASS   | Pass      | three cards of different content, one height           |
| SettingGrid › Open card spans the row       | PASS   | Pass      | open card width equals the grid's; back on cancel      |

Legend: Pending | Running | PASS | FAIL

## Static Stories Status

- [x] Default story (each component)
- [x] Open, Saving, SaveRejected, HostErrorMessage (SettingCard)
- [x] Saving, SaveRejected, Rows (SettingToggle)
- [x] Off (dimmed), On, Disabled, OneSubjectPerGroup (SettingGroup)
- [x] ResponsiveByContainer, OpenCardSpansRow, TwoColumnsMax, Empty (SettingGrid)
- [x] Disabled state stories
- [x] Loading (saving) state stories
- [x] Error state stories
- [x] Long content / edge cases
- [x] Dark theme (SettingCard)

## Lint Status

- [x] No lint errors
- [x] No warnings

## TypeCheck Status

- [x] No type errors
- [x] All props properly typed

## Overall Component Status

- [x] All tests passing
- [x] Lint clean
- [x] TypeCheck clean
- [x] Stories working
- [ ] Ready for production (pending review)
