import { ReactElement } from 'react';

import { useEpicorPricing } from '@/hooks/useEpicorPricing';
import { useAppSelector } from '@/store';
import { ordersCurrencyFormat } from '@/utils';
import { getDisplayPrice } from '@/utils/b3Product/b3Product';

import { MoneyFormat, ProductItem } from '../types';

interface ProductPriceWithEpicorProps {
  product: ProductItem;
  quantity: number;
  basePrice: number;
  discountedPrice?: number;
  money?: MoneyFormat;
  priceLabel?: string;
  showLoading?: boolean;
  isMobile?: boolean;
}

/**
 * Component to display product price with Epicor pricing support
 * Shows Epicor price for B2B customers, base price for others
 */
export function ProductPriceWithEpicor({
  product,
  quantity,
  basePrice,
  discountedPrice,
  money,
  priceLabel = '',
  showLoading = true,
  isMobile = false,
}: ProductPriceWithEpicorProps): ReactElement {
  const isB2BUser = useAppSelector(({ company }) => company.customer.role) !== 2;

  // Get product ID and SKU
  const productId = product.id || product.product_id;
  const sku = product.sku || '';

  // Use Epicor pricing hook for B2B users
  const { epicorPrice, isLoading, currency } = useEpicorPricing({
    productId: productId || 0,
    sku: sku,
    quantity: quantity || 1,
    enabled: isB2BUser && !!productId,
  });

  // Determine display price - use Epicor price if available, otherwise base price
  const unitPrice = isB2BUser && epicorPrice !== null ? epicorPrice : basePrice;
  const totalPrice = unitPrice * quantity;
  const displayCurrency = isB2BUser && epicorPrice !== null ? currency : 'USD';

  // Format price function
  const formatPrice = (price: number, curr: string) => {
    if (money) {
      return ordersCurrencyFormat(money, price);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
    }).format(price);
  };

  // Get display price with product-specific logic
  const getDisplayPriceValue = (priceValue: number) => {
    const formattedPrice = formatPrice(priceValue, displayCurrency);
    return getDisplayPrice({
      price: formattedPrice,
      productInfo: product,
      showText: formattedPrice,
      forcedSkip: true,
    });
  };

  // Show loading state
  if (isB2BUser && isLoading && showLoading) {
    return (
      <>
        {isMobile && priceLabel && <span>{priceLabel}: </span>}
        <span>Loading...</span>
      </>
    );
  }

  // Show discounted price if available
  if (discountedPrice !== undefined && discountedPrice < unitPrice) {
    const discountedTotal = discountedPrice * quantity;
    return (
      <>
        <span style={{ textDecoration: 'line-through' }}>
          {getDisplayPriceValue(totalPrice)}
        </span>
        <span style={{ color: '#2E7D32', marginLeft: '8px' }}>
          {getDisplayPriceValue(discountedTotal)}
        </span>
      </>
    );
  }

  return <span>{getDisplayPriceValue(totalPrice)}</span>;
}

