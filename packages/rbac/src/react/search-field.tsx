import { useState, type JSX } from 'react';

import { Input } from '@12-apps/ui/form/Input';

/**
 * The commit-on-Enter keyword box both admin grids share (12-13) — the same
 * affordance the future-pay DataViews search carried: typing is local, Enter
 * commits the term and the grid re-fetches from the backend.
 */
export function SearchField(props: {
  placeholder: string;
  testId: string;
  onCommit: (keyword: string) => void;
}): JSX.Element {
  const [keyword, setKeyword] = useState('');
  return (
    <Input
      fullWidth
      type="search"
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      value={keyword}
      data-testid={props.testId}
      onChange={(event) => setKeyword(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onCommit(keyword);
      }}
    />
  );
}
