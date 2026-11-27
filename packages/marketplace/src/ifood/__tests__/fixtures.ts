/**
 * A PLACED payload in the shape iFood's order-details guide documents for the
 * money of an order: `total.subTotal`, `total.deliveryFee`, `total.orderAmount`
 * and `benefits[]` with each sponsor's share in `sponsorshipValues[]`.
 *
 * ESTIMATED: these field names are not in any recorded payload of this repo.
 * They follow https://developer.ifood.com.br/en-US/docs/guides/order/details
 * and must be confirmed against a real order before a host relies on them.
 */
export function ifoodPlacedWithMoney() {
  return {
    id: "evt-money",
    code: "PLC",
    merchantId: "merch-1",
    orderId: "ord-money",
    order: {
      displayId: "7100",
      createdAt: "2026-11-20T18:00:00.000Z",
      orderType: "DELIVERY",
      delivery: { deliveredBy: "IFOOD", deliveryAddress: { streetName: "Rua Frota", streetNumber: "9", neighborhood: "Centro" } },
      items: [{ externalCode: "SKU-1", name: "Burger", quantity: 2, unitPrice: 25 }],
      total: { subTotal: 50, deliveryFee: 6.5, benefits: 8, orderAmount: 48.5 },
      benefits: [
        {
          value: 5,
          target: "CART",
          sponsorshipValues: [
            { name: "IFOOD", value: 3, description: "Cupom de boas-vindas" },
            { name: "MERCHANT", value: 2, description: "Cupom de boas-vindas" },
          ],
        },
        { value: 3, target: "DELIVERY_FEE", sponsorshipValues: [{ name: "EXTERNAL", value: 3 }] },
        { value: 1.5, target: "CART" },
        { value: 0, target: "CART", sponsorshipValues: [{ name: "IFOOD", value: 0 }] },
      ],
    },
  };
}

/** The documented iFood test merchant and order of the FUT-5800 fixtures (invented ids, no real data). */
export const IFOOD_MERCHANT = "6b487a27-c4fc-4f26-b05e-3967c2331882";
export const IFOOD_ORDER_ID = "a1b2c3d4-0000-4000-8000-000000005800";

/**
 * A PLACED as iFood delivers it: the order id and nothing of the order. The
 * shape the Events guide documents and the sandbox delivered on 2026-11-27
 * (`{ id, code, fullCode, orderId, merchantId, createdAt }`).
 */
export function ifoodPlacedById() {
  return {
    id: "evt-plc-1",
    code: "PLC",
    fullCode: "PLACED",
    orderId: IFOOD_ORDER_ID,
    merchantId: IFOOD_MERCHANT,
    createdAt: "2026-11-27T18:00:00.000Z",
  };
}

/**
 * The order `GET /order/v1.0/orders/{id}` answers, in the shape iFood's
 * order-details guide documents (https://developer.ifood.com.br/en-US/docs/guides/order/details):
 * money in reais, `total`, `payments.methods[]`, `items[].options[]`,
 * `delivery.deliveryAddress`. Invented values.
 */
export function ifoodDocumentedOrder() {
  return {
    id: IFOOD_ORDER_ID,
    displayId: "8321",
    orderType: "DELIVERY",
    orderTiming: "IMMEDIATE",
    salesChannel: "IFOOD",
    category: "FOOD",
    createdAt: "2026-11-27T18:00:00.000Z",
    preparationStartDateTime: "2026-11-27T18:00:00.000Z",
    isTest: true,
    merchant: { id: IFOOD_MERCHANT, name: "Loja Teste" },
    customer: {
      id: "cust-doc-1",
      name: "Cliente Teste",
      documentNumber: null,
      ordersCountOnMerchant: 1,
      segmentation: "NEW",
      phone: { number: "0800 000 0000", localizer: "12345678", localizerExpiration: "2026-11-27T21:00:00.000Z" },
    },
    items: [
      {
        index: 1,
        id: "item-1",
        uniqueId: "u-item-1",
        name: "Pizza grande",
        externalCode: "PIZZA-G",
        unit: "UNIT",
        quantity: 1,
        unitPrice: 45.9,
        optionsPrice: 0,
        totalPrice: 45.9,
        price: 45.9,
        observations: "Sem cebola",
        options: [
          { index: 1, id: "opt-1", name: "Mussarela", externalCode: "SAB-MUS", unit: "UNIT", quantity: 1, unitPrice: 0, addition: 0, price: 0, groupName: "Sabor" },
        ],
      },
      {
        index: 2,
        id: "item-2",
        uniqueId: "u-item-2",
        name: "Refrigerante lata",
        externalCode: "REFRI-LATA",
        unit: "UNIT",
        quantity: 2,
        unitPrice: 6,
        optionsPrice: 0,
        totalPrice: 12,
        price: 12,
      },
    ],
    benefits: [],
    total: { subTotal: 57.9, deliveryFee: 5, benefits: 0, additionalFees: 0, orderAmount: 62.9 },
    payments: {
      prepaid: 62.9,
      pending: 0,
      methods: [{ value: 62.9, currency: "BRL", method: "CREDIT", type: "ONLINE", prepaid: true, card: { brand: "VISA" } }],
    },
    delivery: {
      mode: "DEFAULT",
      deliveredBy: "MERCHANT",
      deliveryDateTime: "2026-11-27T18:45:00.000Z",
      observations: null,
      deliveryAddress: {
        streetName: "Rua Exemplo",
        streetNumber: "100",
        formattedAddress: "Rua Exemplo, 100",
        neighborhood: "Centro",
        complement: "Apto 1",
        reference: "Portão azul",
        postalCode: "01001-000",
        city: "São Paulo",
        state: "SP",
        country: "BR",
        coordinates: { latitude: -23.55, longitude: -46.63 },
      },
    },
  };
}
