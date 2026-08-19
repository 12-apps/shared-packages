/**
 * The compact narrow-width panel header.
 *
 * Two properties, and the second is the one that would go unnoticed.
 *
 * **It says where you are.** The chip strip marks the open section, but it
 * scrolls, so the marked chip can be off-screen — the header is the only thing
 * that always answers the question.
 *
 * **It is opt-in.** A consumer that names no section keeps the plain "Back"
 * link. Growing a title and a description by default would push every existing
 * consumer's first field down the page on a patch upgrade, which is the kind of
 * change nobody asked for and everybody notices.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { SettingsLayout } from '../SettingsLayout';
import type { SettingsNavGroup } from '../SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'store',
    label: 'Loja',
    items: [
      { id: 'branding', label: 'Perfil e marca', href: '#/config/branding' },
      { id: 'hours', label: 'Horários', href: '#/config/hours' },
    ],
  },
];

const Anchor = React.forwardRef<
  HTMLAnchorElement,
  { href: string } & React.ComponentPropsWithoutRef<'a'>
>(function Anchor({ href, ...rest }, ref) {
  return <a ref={ref} href={href} {...rest} />;
});

function renderPanel(section?: { title: string; description?: string }): void {
  render(
    <SettingsLayout
      title="Configuração"
      groups={GROUPS}
      activeItemId="branding"
      railBreakpoint={1024}
      navVariant="drilldown"
      atIndex={false}
      indexHref="#/config"
      backLabel="Voltar"
      linkComponent={Anchor}
      {...(section === undefined
        ? {}
        : { sectionTitle: section.title, sectionDescription: section.description })}
    >
      <div data-testid="panel-child">Marca</div>
    </SettingsLayout>,
  );
}

describe('the compact section header', () => {
  it('names the open section beside the back control', () => {
    renderPanel({ title: 'Perfil e marca', description: 'Logo, cores e contato do cardápio.' });

    const header = screen.getByTestId('settings-section-header');
    expect(header).toHaveTextContent('Perfil e marca');
    expect(header).toHaveTextContent('Logo, cores e contato do cardápio.');

    // The visible text is the section, so the control keeps its own accessible
    // name — otherwise a screen reader is handed an icon and a heading and has
    // to infer the verb.
    const back = screen.getByTestId('settings-back');
    expect(back).toHaveAccessibleName('Voltar');
    expect(back).toHaveAttribute('href', '#/config');
  });

  it('takes a title without a description', () => {
    renderPanel({ title: 'Horários' });

    // Asserted as what the header IS rather than as what it lacks: its whole
    // text is the title, so a description would show up here.
    const header = screen.getByTestId('settings-section-header');
    expect(header.textContent).toBe('Horários');
  });

  it('leaves the plain back link alone when no section is named', () => {
    renderPanel(undefined);

    // The two shapes are told apart by where the word lives: the plain link
    // SHOWS "Voltar", while the compact header carries it only as the button's
    // accessible name and shows the section instead.
    const back = screen.getByTestId('settings-back');
    expect(back).toHaveTextContent('Voltar');
    expect(back).toHaveAccessibleName('Voltar');
    expect(screen.getByTestId('panel-child')).toBeInTheDocument();
  });
});
