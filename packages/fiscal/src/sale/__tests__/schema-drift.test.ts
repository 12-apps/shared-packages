/**
 * The `SaleForDocument` type and the JSON schema the fiscal service validates
 * against are two spellings of one contract. Each record below is typed
 * `Record<keyof T, true>`, so the compiler fails it when the TYPE gains or
 * loses a field; the test then fails when the SCHEMA disagrees with it.
 */
import schemaJson from "../../../sidecar/schema/sale-for-document.schema.json";
import type {
  Address,
  BuyerDocument,
  BuyerPresence,
  ContributionCst,
  DocumentPurpose,
  FreightMode,
  IssuerTaxRegime,
  OperationDestination,
  StateRegistrationStatus,
  Uf,
  CardDetails,
  DocumentBuyer,
  DocumentIssuer,
  IbsCbsFigures,
  LineContribution,
  LineIbsCbs,
  PaymentMethod,
  SaleForDocument,
  SaleLine,
  SalePayment,
  TechnicalResponsible,
} from "../types";

interface JsonSchemaObject {
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly enum?: readonly unknown[];
}
type JsonSchemaNode = JsonSchemaObject;

const schema = schemaJson as unknown as JsonSchemaObject & {
  readonly definitions: Readonly<Record<string, JsonSchemaNode>>;
};

function definition(name: string): JsonSchemaNode {
  const node = schema.definitions[name];
  if (node === undefined) throw new Error(`The schema has no definition "${name}".`);
  return node;
}

const fields = <T>(record: Record<keyof T, true>): string[] => Object.keys(record).sort();

function objectOf(node: JsonSchemaNode): JsonSchemaObject {
  const object = node.oneOf?.find((branch) => branch.properties !== undefined);
  return object ?? node;
}

function describedKeys(node: JsonSchemaNode): { required: string[]; properties: string[] } {
  const object = objectOf(node);
  return {
    required: [...(object.required ?? [])].sort(),
    properties: Object.keys(object.properties ?? {}).sort(),
  };
}

const cases: ReadonlyArray<readonly [string, JsonSchemaNode, string[]]> = [
  [
    "SaleForDocument",
    schema,
    fields<SaleForDocument>({
      version: true,
      series: true,
      number: true,
      keyCode: true,
      issuedAt: true,
      operationNature: true,
      purpose: true,
      destination: true,
      presence: true,
      finalConsumer: true,
      intermediary: true,
      issuer: true,
      buyer: true,
      lines: true,
      freight: true,
      payments: true,
      changeCents: true,
      additionalInfo: true,
      technicalResponsible: true,
    }),
  ],
  [
    "Address",
    definition("address"),
    fields<Address>({
      street: true,
      number: true,
      complement: true,
      district: true,
      municipalityIbge: true,
      municipalityName: true,
      uf: true,
      postalCode: true,
      phone: true,
    }),
  ],
  [
    "DocumentIssuer",
    definition("issuer"),
    fields<DocumentIssuer>({
      cnpj: true,
      stateRegistration: true,
      legalName: true,
      tradeName: true,
      taxRegime: true,
      address: true,
    }),
  ],
  [
    "DocumentBuyer",
    definition("buyer"),
    fields<DocumentBuyer>({
      document: true,
      name: true,
      stateRegistrationStatus: true,
      stateRegistration: true,
      email: true,
      address: true,
    }),
  ],
  [
    "SaleLine",
    definition("line"),
    fields<SaleLine>({
      id: true,
      code: true,
      gtin: true,
      description: true,
      ncm: true,
      cest: true,
      cfop: true,
      unit: true,
      quantity: true,
      valueCents: true,
      discountCents: true,
      approximateTaxCents: true,
      additionalInfo: true,
      icms: true,
      pis: true,
      cofins: true,
      ibsCbs: true,
    }),
  ],
  [
    "LineContribution",
    definition("contribution"),
    fields<LineContribution>({ cst: true, baseCents: true, rateBp: true, amountCents: true }),
  ],
  [
    "LineIbsCbs",
    definition("ibsCbs"),
    fields<LineIbsCbs>({ cst: true, classCode: true, figures: true }),
  ],
  [
    "IbsCbsFigures",
    definition("ibsCbsFigures"),
    fields<IbsCbsFigures>({
      baseCents: true,
      reductionBp: true,
      cbsRateBp: true,
      cbsCents: true,
      ibsUfRateBp: true,
      ibsUfCents: true,
      ibsMunRateBp: true,
      ibsMunCents: true,
    }),
  ],
  [
    "SalePayment",
    definition("payment"),
    fields<SalePayment>({ method: true, amountCents: true, card: true, description: true }),
  ],
  [
    "CardDetails",
    definition("payment").properties?.card ?? {},
    fields<CardDetails>({ integrated: true, acquirerCnpj: true, brand: true, authorizationCode: true }),
  ],
  [
    "TechnicalResponsible",
    schema.properties?.technicalResponsible ?? {},
    fields<TechnicalResponsible>({ cnpj: true, contactName: true, email: true, phone: true }),
  ],
];

describe("the SaleForDocument type and its JSON schema", () => {
  it.each(cases)("%s: every field is in the schema, required, and nothing else is", (_name, node, expected) => {
    const described = describedKeys(node);
    expect(described.properties).toEqual(expected);
    expect(described.required).toEqual(expected);
  });

  it("names the same payment methods", () => {
    const methods = fields<Record<PaymentMethod, true>>({
      CASH: true,
      CHECK: true,
      CREDIT_CARD: true,
      DEBIT_CARD: true,
      STORE_CREDIT: true,
      FOOD_VOUCHER: true,
      MEAL_VOUCHER: true,
      GIFT_VOUCHER: true,
      FUEL_VOUCHER: true,
      BANK_SLIP: true,
      BANK_DEPOSIT: true,
      PIX_DYNAMIC: true,
      TRANSFER: true,
      LOYALTY: true,
      PIX_STATIC: true,
      NO_PAYMENT: true,
      OTHER: true,
    });
    const listed = [...(definition("payment").properties?.method?.enum ?? [])].map(String).sort();
    expect(listed).toEqual(methods);
  });

  const enumOf = (node: JsonSchemaNode | undefined): string[] => [...(node?.enum ?? [])].map(String).sort();
  const constsOf = (node: JsonSchemaNode): string[] =>
    (node.oneOf ?? [])
      .map((branch) => (branch.properties?.kind as { const?: unknown } | undefined)?.const)
      .map(String)
      .sort();

  it.each([
    [
      "Uf",
      enumOf(definition("uf")),
      fields<Record<Uf, true>>({
        AC: true, AL: true, AM: true, AP: true, BA: true, CE: true, DF: true, ES: true, GO: true,
        MA: true, MG: true, MS: true, MT: true, PA: true, PB: true, PE: true, PI: true, PR: true,
        RJ: true, RN: true, RO: true, RR: true, RS: true, SC: true, SE: true, SP: true, TO: true,
      }),
    ],
    [
      "BuyerPresence",
      enumOf(schema.properties?.presence),
      fields<Record<BuyerPresence, true>>({
        IN_PERSON: true, INTERNET: true, TELEPHONE: true, HOME_DELIVERY: true, IN_PERSON_OFF_PREMISES: true, OTHER: true,
      }),
    ],
    [
      "FreightMode",
      enumOf(schema.properties?.freight),
      fields<Record<FreightMode, true>>({
        BY_ISSUER: true, BY_RECIPIENT: true, BY_THIRD_PARTY: true, OWN_BY_ISSUER: true, OWN_BY_RECIPIENT: true, NONE: true,
      }),
    ],
    [
      "DocumentPurpose",
      enumOf(schema.properties?.purpose),
      fields<Record<DocumentPurpose, true>>({ NORMAL: true, COMPLEMENTARY: true, ADJUSTMENT: true, RETURN: true }),
    ],
    [
      "OperationDestination",
      enumOf(schema.properties?.destination),
      fields<Record<OperationDestination, true>>({ INTERNAL: true, INTERSTATE: true, FOREIGN: true }),
    ],
    [
      "IssuerTaxRegime",
      enumOf(definition("issuer").properties?.taxRegime),
      fields<Record<IssuerTaxRegime, true>>({ SIMPLES: true, SIMPLES_EXCESS: true, NORMAL: true, MEI: true }),
    ],
    [
      "StateRegistrationStatus",
      enumOf(definition("buyer").properties?.stateRegistrationStatus),
      fields<Record<StateRegistrationStatus, true>>({ CONTRIBUTOR: true, EXEMPT: true, NON_CONTRIBUTOR: true }),
    ],
    [
      "BuyerDocument kinds",
      constsOf(definition("buyerDocument")),
      fields<Record<BuyerDocument["kind"], true>>({ CPF: true, CNPJ: true, FOREIGN: true }),
    ],
    [
      "ContributionCst",
      enumOf(definition("contribution").properties?.cst),
      fields<Record<ContributionCst, true>>({
        "01": true, "02": true, "04": true, "05": true, "06": true, "07": true, "08": true, "09": true,
        "49": true, "50": true, "51": true, "52": true, "53": true, "54": true, "55": true, "56": true,
        "60": true, "61": true, "62": true, "63": true, "64": true, "65": true, "66": true, "67": true,
        "70": true, "71": true, "72": true, "73": true, "74": true, "75": true, "98": true, "99": true,
      }),
    ],
  ])("%s: the schema accepts exactly the type's values", (_name, listed, expected) => {
    expect(listed).toEqual(expected);
  });

  it("is document version 1", () => {
    const version: SaleForDocument["version"] = 1;
    expect(schema.properties?.version).toEqual({ const: version });
  });
});
