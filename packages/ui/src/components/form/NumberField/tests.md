# NumberField Test Status Tracking

## Test Files Status

- [x] NumberField.test.stories.tsx created
- [x] `__tests__/NumberField.test.tsx` (Vitest: helpers + component)
- [x] Core categories implemented (interaction, keyboard, screen reader, visual/layout, edge cases)

## Storybook Tests Status

### Test Results

| Test Name                        | Status | Pass/Fail | Notes                                                   |
| -------------------------------- | ------ | --------- | ------------------------------------------------------- |
| Typing keeps digits only         | PASS   | Pass      | `1a2-3.e` lands as `123`                                |
| Paste keeps digits only          | PASS   | Pass      | `1.500 min` reports `1500`                              |
| Arrows step within bounds        | PASS   | Pass      | step 5, clamped to 5–20; `aria-valuenow` follows        |
| Clearing reports null            | PASS   | Pass      | reported value is `null`, input empty                   |
| Blur clamps typed value          | PASS   | Pass      | typed `5` with min 10 becomes `10` on blur              |
| Suffix inside the border         | PASS   | Pass      | suffix rect inside `.MuiInputBase-root`, right of input |
| Numeric spinbutton               | PASS   | Pass      | `inputmode`, `aria-value*`, suffix in describedby       |

Legend: Pending | Running | PASS | FAIL

## Static Stories Status

- [x] Default story
- [x] WithSuffix, WithBounds
- [x] Empty state story (`null`)
- [x] Error state story
- [x] Disabled state story
- [x] Sizes
- [x] Edge cases (fifteen digits, long suffix)

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
