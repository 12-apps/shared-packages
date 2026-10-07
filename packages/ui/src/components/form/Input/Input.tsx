import { createInput } from "./Input.factory";
import type { InputComponent } from "./Input.factory";
import { TextFieldSlim } from "./text-field-slim";

/**
 * The text input, over `TextFieldSlim` — see `text-field-slim.tsx` for why not
 * MUI's `TextField`, and `Input.factory.tsx` for the body. This entry renders
 * any of the five variants; a control that only ever renders the outlined
 * family can import `@12-apps/ui/form/Input/outlined`, which ships one MUI
 * input instead of three (FUT-1054).
 */
export const Input: InputComponent = createInput(TextFieldSlim);
