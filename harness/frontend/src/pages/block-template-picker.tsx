import { useState } from 'react';

import { BlockTemplatePicker } from '@12-apps/report-builder/react';
import { blockTemplateGroups } from '@12-apps/report-builder/server';

/**
 * The published "Adicionar bloco" picker, with the published template groups.
 *
 * Both halves come from the tarball: the component from the react entry, the
 * groups from the server entry. That pairing is the thing worth proving — the
 * groups are built from starters validated against the live catalog, and a
 * picker rendering them is the only place those two ever meet.
 */
export function BlockTemplatePickerPage(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [pickedHasSpec, setPickedHasSpec] = useState<string>('');

  return (
    <div data-testid="block-template-picker-page">
      <h2 style={{ marginTop: 0 }}>Block template picker</h2>

      <button type="button" onClick={() => setOpen(true)} data-testid="open-picker">
        Adicionar bloco
      </button>

      <BlockTemplatePicker
        open={open}
        groups={blockTemplateGroups()}
        onSelect={(template) => {
          setPicked(template.id);
          // The caller needs the SPEC, not just an id — that is why onSelect
          // hands back the whole template. Recording whether one arrived
          // proves the blank template is distinguishable from the rest.
          setPickedHasSpec(template.spec === null ? 'no' : 'yes');
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />

      <dl style={{ marginTop: 24, fontSize: 13, color: '#555' }}>
        <dt>picked</dt>
        <dd data-testid="picked-id">{picked || '(nenhum)'}</dd>
        <dt>carries a spec</dt>
        <dd data-testid="picked-has-spec">{pickedHasSpec || '(n/a)'}</dd>
      </dl>
    </div>
  );
}
