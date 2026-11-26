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
