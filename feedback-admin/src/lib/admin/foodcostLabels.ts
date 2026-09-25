const integerFormat = new Intl.NumberFormat("uk-UA");

export function foodcostStoreCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const form = lastTwo >= 11 && lastTwo <= 14 ? "магазинів"
    : last === 1 ? "магазин" : last >= 2 && last <= 4 ? "магазини" : "магазинів";
  return `${integerFormat.format(count)} ${form}`;
}
