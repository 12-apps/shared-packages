// RULE 2 violation fixture, JSX flavour — linted as packages/ui/src/<file>.
// The provider name reaches the screen as an attribute string and as element
// text, neither of which is a plain `Literal` statement.
export function ConnectBanner() {
  return (
    <section title="Conectar conta PagBank">
      Stone conectado
    </section>
  );
}
