/**
 * Rappi fixtures, taken from Rappi's public developer portal
 * (dev-portal.rappi.com, read 2026-11-13):
 *
 * - {@link portalOrder} is the `GET orders` sample response's one element
 *   (api-reference/orders), verbatim, including its sums that do not add up
 *   (`total_products` 204000 against the items, `total_order` 204180). The
 *   portal says NEW_ORDER "is going to send the same information that we can
 *   get from the getOrders endpoint", so this is the NEW_ORDER body. That the
 *   webhook body is ONE element, not the list, is ESTIMATED (the portal shows
 *   no NEW_ORDER example).
 * - {@link portalCancel}, {@link portalOtherEvent}, {@link portalScheduled}
 *   and {@link portalScheduledCancelled} are webhook-events' own examples,
 *   verbatim (the scheduled one's elided `"..."` customer fields kept).
 * - {@link signed} builds a `Rappi-Signature` the way the portal's
 *   "Validating Your Signature" describes (the hex digest is ESTIMATED).
 */

import { createHmac } from "node:crypto";

export const PORTAL_ORDER_ID = "392625";
/** The sample's `store.internal_id`: Rappi's id for the store, the `store_id` of every other event. */
export const PORTAL_STORE_ID = "30000011";

/** Where the tests say Rappi lives. Not Rappi's hosts: the adapter takes them as config. */
export const API_BASE = { SANDBOX: "https://api.sandbox.rappi.example.test", PRODUCTION: "https://api.rappi.example.test" };
export const AUTH_BASE = { SANDBOX: "https://auth.sandbox.rappi.example.test", PRODUCTION: "https://auth.rappi.example.test" };
export const PORTAL = "https://partners.rappi.example.test";

export function portalOrder(orderId: string = PORTAL_ORDER_ID) {
  return {
    order_detail: {
      order_id: orderId,
      delivery_operation_type: "regular",
      cooking_time: 10,
      min_cooking_time: 5,
      max_cooking_time: 20,
      created_at: "2019-04-10T11:12:57.000Z",
      delivery_method: "delivery",
      payment_method: "cc",
      delivery_information: {
        city: "Ciudad de México",
        complete_address: "Nombre de la calle 5050. Barrio. 12345. Ciudad De México",
        street_number: "5050",
        neighborhood: "Barrio",
        complement: "Portón verde",
        postal_code: "12345",
        street_name: "Nombre de la calle",
        has_reverse_geocoding_result: true,
        match_original_address: true,
        match_geocoding_address: true,
      },
      billing_information: {
        address: "148 Davis Court",
        billing_type: "Bill",
        document_number: "32432342",
        document_type: "DNI",
        email: "client@gmail.com",
        name: "John Doe",
        phone: "43333222",
      },
      totals: {
        total_products: 204000,
        total_discounts: 173685,
        total_order: 204180,
        total_to_pay: 0,
        discount_by_support: 0,
        charges: { shipping: 50, service_fee: 100 },
        other_totals: { tip: 30, total_rappi_pay: 0, total_rappi_credits: 0 },
      },
      items: [
        {
          sku: "1234",
          id: "2089918083",
          name: "Chicken and Apple Salad",
          type: "PRODUCT",
          comments: "No vinegar",
          price: 28900,
          quantity: 3,
          subitems: [{ sku: "11", id: "10005260", name: "Burrata Cheese", type: "TOPPING", price: 13500, quantity: 1 }],
        },
        {
          id: "2089918082",
          name: "Seafood Salad",
          comments: "",
          price: 34900,
          quantity: 2,
          subitems: [
            { id: "9928277", name: "With white vinaigrette", price: 0, quantity: 1 },
            { id: "10005257", name: "Ricotta Cheese", price: 3500, quantity: 1 },
          ],
        },
      ],
      delivery_discount: { total_percentage_discount: 100, total_value_discount: 50 },
      discounts: [
        {
          value: 7600,
          description: "Envío gratis",
          title: "Envío gratis",
          product_id: null,
          sku: null,
          type: "shipping",
          raw_value: 100,
          value_type: "percentage",
          max_value: null,
          includes_toppings: false,
          percentage_by_rappi: 100,
          percentage_by_partners: 0,
          amount_by_rappi: 7600,
          amount_by_partner: 0,
          discount_product_units: 0,
          discount_product_unit_value: null,
        },
      ],
      vendors: [{ id: 100200300, type: "tuweb", vendor_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", flow_type: "ai-agent" }],
    },
    customer: {
      first_name: "John",
      last_name: "Doe",
      phone_number: "3163535",
      document_number: "34545678",
      user_type: "USER_VIP",
    },
    store: { internal_id: PORTAL_STORE_ID, external_id: "123445", name: "Store 1" },
  };
}

/** ORDER_EVENT_CANCEL, the portal's example (its own ids; `order_id` overridable to match an order). */
export function portalCancel(orderId = "106", storeId = "900109448") {
  return { event: "canceled_with_charge", order_id: orderId, store_id: storeId };
}

/** ORDER_OTHER_EVENT, the portal's example. */
export function portalOtherEvent(orderId = "344949817") {
  return {
    event: "taken_visible_order",
    order_id: orderId,
    store_id: "10000682",
    event_time: "2023-05-04 12:01:22",
    additional_information: {
      courier_data: {
        id: 729365,
        phone: "3118012176",
        full_name: "Daletzi Karina Olmedo Plata",
        last_name: "Olmedo Plata",
        first_name: "Daletzi Karina",
        profile_pic: null,
      },
      eta_to_store: 147,
      storekeeper_name: "Daletzi Karina Olmedo Plata",
    },
  };
}

/** NEW_ORDER_SCHEDULED, the portal's example: the getOrders shape, prices zero, `action: "scheduled"`. */
export function portalScheduled() {
  return {
    order_detail: {
      order_id: "2150558091",
      place_at: "2026-07-22 17:35:00",
      delivery_method: "delivery",
      payment_method: "cash",
      totals: { total_order: 0, total_to_pay: 0, charges: {}, other_totals: { tip: 0, total_rappi_pay: 0, total_rappi_credits: 0 } },
      items: [
        { id: "729970", name: "Product 8", quantity: 4, sku: "0007", price: 0, unit_price_with_discount: 0, unit_price_without_discount: 0 },
      ],
    },
    customer: {
      first_name: "...",
      last_name: "...",
      email: "...",
      phone_number: "...",
      document_type: "...",
      document_number: "...",
    },
    store: { internal_id: "900105814", external_id: "900105814", name: "..." },
    action: "scheduled",
  };
}

/** NEW_ORDER_SCHEDULED_CANCELLED, the portal's example. */
export function portalScheduledCancelled() {
  return { order_detail: { order_id: "2150558091", store_id: "900105814", place_at: "2026-07-22 17:35:00" }, action: "cancelled" };
}

/** A `Rappi-Signature` header for `body`: `t=<t>,sign=<hex HMAC-SHA256 of "t.body">`. */
export function signed(body: string, secret: string, t = "1731499200"): string {
  return `t=${t},sign=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
}
