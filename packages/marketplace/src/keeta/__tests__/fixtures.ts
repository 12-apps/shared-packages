/**
 * Keeta fixtures, taken from Keeta's own documentation
 * (https://api-docs.mykeeta.com/apis/opendelivery, read 2026-11-26):
 *
 * - {@link keetaOrder} is `orderDetails`' "Apêndice A — Exemplo de pedido
 *   (Brasil)", verbatim: a merchant-delivered order paid by PIX, with its
 *   encrypted fields (`ENC_…`). Its sums add up: 35.60 + 13.00 + 7.99 − 5.00
 *   = 51.59.
 * - {@link keetaEvent} is `newEvent`'s example body.
 * - {@link KEETA_MERCHANT_INFO} is `getMerchantInfo`'s 200 example;
 *   {@link KEETA_AUTHORIZATION_WEBHOOK} is `receiveAuthorizationWebhook`'s.
 * - {@link KEETA_SIGNATURE_EXAMPLES} are "Exemplos de string de assinatura".
 */

export const KEETA_ORDER_ID = "783441058793308";
/** The example's `merchant.id`: the SOFTWARE's merchant id. */
export const KEETA_MERCHANT_ID = "LOJA-SP-001";
/** The example's encrypted values, and what `batchDecrypt` answers for two of them. */
export const ENCRYPTED = {
  phone: "ENC_#MQesaE=#1#",
  district: "ENC_#Xp91ab=#1#",
  number: "ENC_#Lk20qz=#1#",
  complement: "ENC_#Tt77wa=#1#",
  formattedAddress: "ENC_#Aa13fx=#1#",
} as const;

export function keetaOrder(id: string = KEETA_ORDER_ID, deliveredBy: string = "MERCHANT") {
  return {
    id,
    type: "DELIVERY",
    displayId: "4821",
    sourceAppId: "Keeta",
    category: "FOOD",
    createdAt: "2026-10-13T20:41:05Z",
    lastEvent: "CREATED",
    orderTiming: "INSTANT",
    preparationStartDateTime: "2026-10-13T20:41:05Z",
    merchant: { id: KEETA_MERCHANT_ID, name: "Lanchonete Moema" },
    items: [
      {
        id: "it-1",
        index: 0,
        name: "Coxinha de frango com catupiry",
        externalCode: "PDV-1001",
        unit: "UN",
        quantity: 4,
        unitPrice: { value: 7.9, currency: "BRL" },
        optionsPrice: { value: 1.0, currency: "BRL" },
        totalPrice: { value: 35.6, currency: "BRL" },
        specialInstructions: "Bem quentinha, por favor",
        options: [
          {
            id: "op-1",
            name: "Molho de pimenta",
            externalCode: "PDV-9001",
            unit: "UN",
            quantity: 1,
            unitPrice: { value: 1.0, currency: "BRL" },
            totalPrice: { value: 1.0, currency: "BRL" },
          },
        ],
      },
      {
        id: "it-2",
        index: 1,
        name: "Guaraná Antarctica lata 350 ml",
        externalCode: "PDV-3005",
        unit: "UN",
        quantity: 2,
        unitPrice: { value: 6.5, currency: "BRL" },
        totalPrice: { value: 13.0, currency: "BRL" },
      },
    ],
    otherFees: [
      { name: "Taxa de entrega", type: "DELIVERY_FEE", receivedBy: "MERCHANT", price: { value: 7.99, currency: "BRL" } },
    ],
    discounts: [
      {
        amount: { value: 5.0, currency: "BRL" },
        target: "CART",
        sponsorshipValues: [{ name: "MERCHANT", amount: { value: 5.0, currency: "BRL" }, discountCode: "BEMVINDO5" }],
      },
    ],
    total: {
      itemsPrice: { value: 48.6, currency: "BRL" },
      otherFees: { value: 7.99, currency: "BRL" },
      discount: { value: 5.0, currency: "BRL" },
      orderAmount: { value: 51.59, currency: "BRL" },
    },
    payments: {
      prepaid: 51.59,
      pending: 0,
      methods: [{ value: 51.59, currency: "BRL", type: "PREPAID", method: "PIX" }],
    },
    customer: { id: "cust-90817", name: "Mariana", phone: { number: ENCRYPTED.phone }, ordersCountOnMerchant: 3 },
    delivery: {
      deliveredBy,
      deliveryAddress: {
        country: "BR",
        state: "BR-SP",
        city: "São Paulo",
        district: ENCRYPTED.district,
        street: "Rua Domingos de Morais",
        number: ENCRYPTED.number,
        complement: ENCRYPTED.complement,
        reference: "Próximo à estação Santa Cruz",
        formattedAddress: ENCRYPTED.formattedAddress,
        postalCode: "04010-100",
        coordinates: { latitude: -23.5874, longitude: -46.6343 },
      },
      estimatedDeliveryDateTime: "2026-10-13T21:25:00Z",
    },
    sendDelivered: true,
    sendTracking: true,
  };
}

/**
 * `batchDecrypt`'s 200 example (the phone and the district), plus the
 * number and the complement in the same shape.
 */
export const KEETA_DECRYPTED = {
  plainInfos: [
    { cipherText: ENCRYPTED.phone, plainText: "+55 11 98765-4321", errorCode: 0, errorMsg: "success" },
    { cipherText: ENCRYPTED.district, plainText: "Vila Mariana", errorCode: 0, errorMsg: "success" },
    { cipherText: ENCRYPTED.number, plainText: "1200", errorCode: 0, errorMsg: "success" },
    { cipherText: ENCRYPTED.complement, plainText: "Apto 12", errorCode: 0, errorMsg: "success" },
  ],
};

/** One `newEvent` body, by the example's fields. */
export function keetaEvent(eventType: string, orderId: string = KEETA_ORDER_ID, eventId = `evt-${orderId}-${eventType}`) {
  return {
    eventId,
    eventType,
    orderId,
    orderURL: `https://open.mykeeta.com/api/open/opendelivery/v1/orders/${orderId}`,
    createdAt: "2026-10-13T20:41:05Z",
    sourceAppId: "Keeta",
    ...(eventType === "CANCELLED"
      ? {
          // `EventMetadataCancel`'s example: metadata is a JSON STRING.
          metadata:
            '{"orderViewId":2340761421922475,"opTime":1764488817847,"cancelType":505001,"opType":30,"shopId":159400835,"cancelReason":"Preparo dos alimentos demorado","status":50}',
        }
      : {}),
  };
}

export const KEETA_MERCHANT_INFO = {
  userId: 12345678,
  brandId: 1001,
  brandName: "Sample Brand",
  authorizedShops: [
    {
      id: 159416882,
      name: "stbaxi3 - API Test store",
      address: "Rua Augusta, 500, São Paulo, SP, Brasil",
      longitude: 46.049568,
      latitude: -18.770281,
      timeZone: "America/Sao_Paulo",
    },
  ],
  page: { pageNum: 1, pageSize: 10, totalPage: 1, totalCount: 3 },
};

export const KEETA_AUTHORIZATION_WEBHOOK = {
  clientId: 2666245991,
  authId: "41008",
  opType: 1,
  shopId: 478268,
  shopName: "10 Shanghai",
  createTime: 1753151456973,
};

/** "Exemplos de string de assinatura": URL with its query, the body as written, and the string Keeta signs. */
export const KEETA_SIGNATURE_EXAMPLES = [
  {
    url: "https://api.exemplo.com.br/v1/pedidos?pagina=2&limite=10&ordem=data",
    body: undefined,
    signed: "https://api.exemplo.com.br/v1/pedidos&limite=10&ordem=data&pagina=2",
  },
  {
    url: "https://api.exemplo.com.br/v1/pedidos",
    body: { produto: "Coxinha", quantidade: 6 },
    signed: 'https://api.exemplo.com.br/v1/pedidos&{"produto":"Coxinha","quantidade":6}',
  },
  {
    url: "https://api.exemplo.com.br/v1/produtos?versao=v2&formato=json",
    body: { nome: "Pão de queijo", preco: 12.9 },
    signed: 'https://api.exemplo.com.br/v1/produtos&formato=json&versao=v2&{"nome":"Pão de queijo","preco":12.9}',
  },
] as const;

export const API_BASE = { SANDBOX: "https://sandbox.keeta.example.test", PRODUCTION: "https://keeta.example.test" } as const;
