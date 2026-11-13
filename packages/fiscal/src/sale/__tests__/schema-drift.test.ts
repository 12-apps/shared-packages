/**
 * The `SaleForDocument` type and the JSON schema the fiscal service validates
 * against are two spellings of one contract. Each record below is typed
 * `Record<keyof T, true>`, so the compiler fails it when the TYPE gains or
 * loses a field; the test then fails when the SCHEMA disagrees with it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  Address,
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

const schemaPath = fileURLToPath(new URL("../../../sidecar/schema/sale-for-document.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as JsonSchemaObject & {
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

  it("is document version 1", () => {
    const version: SaleForDocument["version"] = 1;
    expect(schema.properties?.version).toEqual({ const: version });
  });
});
