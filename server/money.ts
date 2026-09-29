import { Decimal } from "decimal.js";
import { assert } from "./errors.js";
import type { LineItem } from "../shared/domain.js";
const cents = (v: number) =>
  new Decimal(v).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
export function calculate(items: LineItem[], delivery = 0) {
  let subtotal = new Decimal(0),
    discount = new Decimal(0),
    tax = new Decimal(0);
  for (const item of items) {
    const gross = cents(item.unit_price)
      .mul(item.quantity)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const reduction = gross
      .mul(item.discount)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const itemTax = gross
      .sub(reduction)
      .mul(item.tax)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    subtotal = subtotal.add(gross);
    discount = discount.add(reduction);
    tax = tax.add(itemTax);
  }
  const shipping = cents(delivery),
    total = subtotal.sub(discount).add(tax).add(shipping);
  assert(
    total.isFinite() && total.gte(0) && total.lte(100000000000000),
    422,
    "The total exceeds the supported transaction limit.",
  );
  return {
    subtotal: subtotal.toNumber(),
    discount: discount.toNumber(),
    tax: tax.toNumber(),
    delivery: shipping.toNumber(),
    total: total.toNumber(),
  };
}
export function amountMinor(amount: number) {
  const result = cents(amount);
  assert(
    result.isFinite() && result.gt(0) && result.lte(100000000000000),
    422,
    "Enter a valid positive amount.",
  );
  return result.toNumber();
}
