/**
 * Open Delivery v1.7.1 fixtures, taken from the spec itself
 * (`abrasel-nacional.github.io/opendelivery/openapi.yaml`):
 *
 * - {@link specOrder} is the spec's `orderExample` (`components/examples`),
 *   verbatim, including its sums that do not add up (item total 50 with unit
 *   43 + options 50; `orderAmount` 35.50 against 50 + 5 − 20).
 * - {@link specDeliveryAddress} is the `Order.delivery.deliveryAddress`
 *   schema's own field `example:` values (`street`, `number`, `district`,
 *   `BR-SP`), the shape the schema names, where the example uses older keys.
 * - {@link specEvent} is an `Event` built from its schema's fields; the spec
 *   ships no event example, so the ids are the order example's.
 */

export const SPEC_ORDER_ID = "4818e72f-2304-466f-9fe7-af08f34ac4ed";
/** The order example's `merchant.id`. */
export const SPEC_MERCHANT_ID = "7fb59cb8-5808-40c8-b967-1b3f20ee39cd";

export function specOrder(id: string = SPEC_ORDER_ID) {
  return {
    id,
    type: "DELIVERY",
    displayId: "12345",
    createdAt: "2021-05-27T19:38:10.332Z",
    orderTiming: "INSTANT",
    preparationStartDateTime: "2021-05-27T19:45:10.332Z",
    merchant: { id: SPEC_MERCHANT_ID, name: "Plaza Pizza" },
    items: [
      {
        id: "732bd31e-77fc-47ee-88ee-a0437f97b198",
        index: 0,
        name: "Medium - 2 flavors",
        externalCode: "22",
        unit: "UNIT",
        quantity: 1,
        specialInstructions: "Do not put onions.",
        unitPrice: { value: 43.0, currency: "BRL" },
        optionsPrice: { value: 50.0, currency: "BRL" },
        totalPrice: { value: 50.0, currency: "BRL" },
        options: [
          {
            id: "e5232f14-430c-4a94-8ff6-289d5a16a87a",
            name: "1/2 Pepperoni",
            externalCode: "23",
            unit: "UNIT",
            quantity: 1,
            unitPrice: { value: 50.0, currency: "BRL" },
            price: { value: 50.0, currency: "BRL" },
            specialInstructions: "None",
          },
          {
            id: "7e507cab-7235-4f75-a0c2-e955fb2f2048",
            name: "1/2 Mozzarella",
            externalCode: "24",
            unit: "UNIT",
            quantity: 1,
            unitPrice: { value: 30.0, currency: "BRL" },
            price: { value: 30.0, currency: "BRL" },
            specialInstructions: "None",
          },
        ],
      },
    ],
    otherFees: [
      {
        name: "Delivery",
        type: "DELIVERY_FEE",
        receivedBy: "MARKETPLACE",
        receiverDocument: "1234",
        price: { value: 5.0, currency: "BRL" },
        observation: "None",
      },
    ],
    discounts: [
      {
        amount: { value: 20.0, currency: "BRL" },
        target: "DELIVERY_FEE",
        sponsorshipValues: [
          { name: "MARKETPLACE", amount: { value: 10.0, currency: "BRL" } },
          { name: "MERCHANT", amount: { value: 10.0, currency: "BRL" } },
        ],
      },
    ],
    total: {
      itemsPrice: { value: 50.0, currency: "BRL" },
      otherFees: { value: 5.0, currency: "BRL" },
      discount: { value: 20.0, currency: "BRL" },
      orderAmount: { value: 35.5, currency: "BRL" },
    },
    payments: {
      prepaid: 55.0,
      pending: 0,
      methods: [{ value: 55.0, currency: "BRL", method: "FOOD_VOUCHER", methodInfo: "None" }],
    },
    customer: {
      id: "d9730653-a8ba-4e85-8dbb-b5697e6ae8d5",
      phone: { number: "11999999999", extension: "0" },
      documentNumber: "12345",
      name: "John",
      ordersCountOnMerchant: 1,
    },
    delivery: {
      deliveredBy: "MERCHANT",
      deliveryAddress: {
        country: "BR",
        streetName: "Gomes de Carvalho Street",
        formattedAddress: "string",
        streetNumber: "100",
        city: "São Paulo",
        postalCode: "20111-000",
        coordinates: { latitude: -23.54754, longitude: -46.63611 },
        neighborhood: "Moema",
        state: "SP",
        complement: "102",
      },
      estimatedDeliveryDateTime: "2021-05-27T20:45:10.332Z",
      deliveryDateTime: "2021-05-27T20:47:10.443Z",
    },
    extraInfo: "None",
  };
}

/** The `deliveryAddress` schema's own `example:` values. */
export const specDeliveryAddress = {
  country: "BR",
  state: "BR-SP",
  city: "São Paulo",
  district: "Moema",
  street: "Plaza Avenue",
  number: "100",
  complement: "BL 02 AP 31",
  reference: "Yellow House",
  formattedAddress: "Plaza Avenue, 100, BL 02 AP 31, Moema - São Paulo, SP - Brazil",
  postalCode: "20111-000",
  coordinates: { latitude: -23.54823, longitude: -46.63632 },
};

/** One webhook `Event` (the `newEvent` body), by its schema's required fields. */
export function specEvent(eventType: string, orderId: string = SPEC_ORDER_ID, eventId = `evt-${orderId}-${eventType}`) {
  return {
    eventId,
    eventType,
    orderId,
    orderURL: `https://od.example.test/v1/orders/${orderId}`,
    createdAt: "2021-05-27T19:38:10.332Z",
    sourceAppId: "b1c9c4f0-6d5e-4b1a-9c4f-0b1c9c4f06d5",
    ...(eventType.startsWith("CANCEL") ? { metadata: { reason: "Item unavailable", code: "UNAVAILABLE_ITEM" } } : {}),
  };
}

export const API_BASE = { SANDBOX: "https://sandbox.od.example.test", PRODUCTION: "https://od.example.test" } as const;
export const PORTAL = "https://portal.od.example.test/";
