import * as React from 'react';

/** The children with `divider` cloned between each adjacent pair. */
export function withDividers(
  children: React.ReactNode,
  divider: React.ReactNode | undefined,
): React.ReactNode {
  if (divider === undefined || divider === null) return children;
  const items = React.Children.toArray(children);
  return items.flatMap((child, index) =>
    index === 0
      ? [child]
      : [React.createElement(React.Fragment, { key: `divider-${index}` }, divider), child],
  );
}
