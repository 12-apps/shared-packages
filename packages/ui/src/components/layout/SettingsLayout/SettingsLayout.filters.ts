import type { SettingsNavGroup, SettingsNavItem } from './SettingsLayout.types';

/** Case-insensitive filter over item label + keywords; drops emptied groups. */
export function filterGroups(groups: SettingsNavGroup[], query: string): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const matches = (item: SettingsNavItem): boolean =>
    item.label.toLowerCase().includes(needle) ||
    (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle));
  return groups
    .map((group) => ({ ...group, items: group.items.filter(matches) }))
    .filter((group) => group.items.length > 0);
}

/** Label of the active item, shown in the `switcher`'s collapsed header. */
export function activeItemLabel(
  groups: SettingsNavGroup[],
  activeItemId?: string,
): string | undefined {
  return groups.flatMap((group) => group.items).find((item) => item.id === activeItemId)?.label;
}
