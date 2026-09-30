/**
 * `@12-apps/ui/form/MenuSelect`: the menu select, and nothing that searches.
 * Its own entry so a bundle can take it without `Select`'s searchable engine.
 */
export { MenuSelect } from './Select.menu';
export type {
  MenuSelectProps,
  SelectBaseProps,
  SelectOption,
  SelectProps,
  SelectValue,
  SelectVariant,
} from './Select.types';
