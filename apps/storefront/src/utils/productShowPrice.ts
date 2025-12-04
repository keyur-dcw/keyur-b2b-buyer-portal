import { getProductCustomFields } from '@/shared/service/bc/graphql/product';

const SHOW_PRICE_FIELD_NAME = 'show_price';

const showPriceCache = new Map<number, boolean>();

const normalize = (value: string | number | null | undefined) =>
  (value ?? '').toString().trim().toLowerCase();

export const clearShowPriceCache = () => showPriceCache.clear();

export const isProductShowPriceEnabled = async (
  productId?: number | string | null,
): Promise<boolean> => {
  const numericId = Number(productId);
  if (!numericId) {
    return false;
  }

  if (showPriceCache.has(numericId)) {
    return showPriceCache.get(numericId) ?? false;
  }

  try {
    const customFields = await getProductCustomFields(numericId);

    const showPriceField = customFields.find(
      (field) => normalize(field.name) === SHOW_PRICE_FIELD_NAME,
    );

    const isEnabled = normalize(showPriceField?.value) === 'yes';
    showPriceCache.set(numericId, isEnabled);

    return isEnabled;
  } catch (error) {
    console.error('[ShowPrice] Unable to determine show_price for product', productId, error);
    showPriceCache.set(numericId, false);
    return false;
  }
};

