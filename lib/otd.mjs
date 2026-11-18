// Out-the-door estimate, monthly payment and the list-price cap a budget allows.
// Pure functions, usable in Node and in the browser. All arithmetic in cents.

const cents = (value) => Math.round((value ?? 0) * 100);

// quote: { price, doc, extraTaxable, extraNonTaxable, transport, transportMax, transportTaxable, lowerBound }
// tax:   { rate, registrationReserve }
export function estimate(quote, tax, transportOverride) {
  if (!quote || !(quote.price > 0)) return null;
  const total = (transport) => {
    const shipping = cents(transport);
    const taxed = cents(quote.price) + cents(quote.extraTaxable) + (quote.transportTaxable ? shipping : 0);
    const untaxed = cents(quote.doc) + cents(quote.extraNonTaxable) + (quote.transportTaxable ? 0 : shipping);
    return (Math.round(taxed * (1 + tax.rate)) + cents(tax.registrationReserve) + untaxed) / 100;
  };
  const transport = transportOverride ?? quote.transport;
  const result = { otd: total(transport), lowerBound: Boolean(quote.lowerBound) };
  if (transportOverride === undefined && quote.transportMax !== undefined) result.otdMax = total(quote.transportMax);
  return result;
}

// Level-payment loan. Returns 0 when nothing is financed.
export function monthlyPayment(otd, { downPayment = 0, apr, termMonths }) {
  const principal = otd - downPayment;
  if (principal <= 0) return 0;
  const r = apr / 12;
  if (r === 0) return Math.round((principal / termMonths) * 100) / 100;
  return Math.round((principal * r) / (1 - (1 + r) ** -termMonths) * 100) / 100;
}

// Highest list price whose estimate stays within the cap.
export function maxListPrice(otdCap, tax, { extraTaxable = 0, extraNonTaxable = 0 } = {}) {
  const price = (otdCap - tax.registrationReserve - extraNonTaxable) / (1 + tax.rate) - extraTaxable;
  return Math.floor(price * 100) / 100;
}

export function money(value, digits = 2) {
  if (value === null || value === undefined) return "";
  return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
