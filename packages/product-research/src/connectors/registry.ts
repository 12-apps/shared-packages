import type { PriceSourceConnector } from './types';

/**
 * Connector registry — hosts (and future connector modules in this package)
 * register by source type. Kept instance-based rather than module-global so
 * two hosts in one process (or tests) never share state.
 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, PriceSourceConnector>();

  register(connector: PriceSourceConnector): this {
    this.connectors.set(connector.type, connector);
    return this;
  }

  get(type: string): PriceSourceConnector | undefined {
    return this.connectors.get(type);
  }

  types(): string[] {
    return [...this.connectors.keys()];
  }
}
