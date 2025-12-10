import { useEffect, useState } from 'react';
import styled from '@emotion/styled';
import { Delete } from '@mui/icons-material';
import { Alert, Box, Grid, Typography } from '@mui/material';

import { B3QuantityTextField } from '@/components';
import B3Dialog from '@/components/B3Dialog';
import CustomButton from '@/components/button/CustomButton';
import B3Spin from '@/components/spin/B3Spin';
import Cookies from 'js-cookie';

import { CART_URL, CHECKOUT_URL, PRODUCT_DEFAULT_IMAGE, WEBHOOK_CONFIG, getWebhookUrl } from '@/constants';
import { useMobile } from '@/hooks/useMobile';
import { useB3Lang } from '@/lib/lang';
import { getCart } from '@/shared/service/bc/graphql/cart';
import { activeCurrencyInfoSelector, rolePermissionSelector, useAppSelector } from '@/store';
import { ShoppingListStatus } from '@/types/shoppingList';
import { currencyFormat, snackbar } from '@/utils';
import b2bLogger from '@/utils/b3Logger';
import { storeHash } from '@/utils/basicConfig';
import { setModifierQtyPrice } from '@/utils/b3Product/b3Product';
import {
  addLineItems,
  getProductOptionsFields,
  ProductsProps,
} from '@/utils/b3Product/shared/config';
import b3TriggerCartNumber from '@/utils/b3TriggerCartNumber';
import { createOrUpdateExistingCart } from '@/utils/cartUtils';

interface ShoppingProductsProps {
  shoppingListInfo: any;
  role: string | number;
  products: ProductsProps[];
  successProducts: number;
  allowJuniorPlaceOrder: boolean;
  getProductQuantity?: (item: ProductsProps) => number;
  onProductChange?: (products: ProductsProps[]) => void;
  setValidateFailureProducts: (arr: ProductsProps[]) => void;
  setValidateSuccessProducts: (arr: ProductsProps[]) => void;
  textAlign?: string;
  backendValidationEnabled: boolean;
}

interface FlexProps {
  isHeader?: boolean;
  isMobile?: boolean;
}

interface FlexItemProps {
  width?: string;
  padding?: string;
  flexBasis?: string;
  alignItems?: string;
  flexDirection?:
    | 'column'
    | 'inherit'
    | '-moz-initial'
    | 'initial'
    | 'revert'
    | 'unset'
    | 'column-reverse'
    | 'row'
    | 'row-reverse';
  textAlignLocation?: string;
}

const Flex = styled('div')<FlexProps>(({ isHeader, isMobile }) => {
  const headerStyle = isHeader
    ? {
        borderBottom: '1px solid #D9DCE9',
        paddingBottom: '8px',
        alignItems: 'center',
      }
    : {
        alignItems: 'flex-start',
      };

  const mobileStyle = isMobile
    ? {
        borderTop: '1px solid #D9DCE9',
        padding: '12px 0 12px',
        '&:first-of-type': {
          marginTop: '12px',
        },
      }
    : {};

  const flexWrap = isMobile ? 'wrap' : 'initial';

  return {
    display: 'flex',
    wordBreak: 'break-word',
    padding: '8px 0 0',
    gap: '8px',
    flexWrap,
    ...headerStyle,
    ...mobileStyle,
  };
});

const FlexItem = styled(Box)(
  ({
    width,
    padding = '0',
    flexBasis,
    flexDirection = 'row',
    alignItems,
    textAlignLocation,
  }: FlexItemProps) => ({
    display: 'flex',
    justifyContent: textAlignLocation === 'right' ? 'flex-end' : 'flex-start',
    flexDirection,
    flexGrow: width ? 0 : 1,
    flexShrink: width ? 0 : 1,
    alignItems: alignItems || 'flex-start',
    flexBasis,
    width,
    padding,
  }),
);

const ProductHead = styled('div')(() => ({
  fontSize: '0.875rem',
  lineHeight: '1.5',
  color: '#263238',
}));

const ProductImage = styled('img')(() => ({
  width: '60px',
  borderRadius: '4px',
  flexShrink: 0,
}));

const defaultItemStyle = {
  default: {
    width: '15%',
  },
  qty: {
    width: '80px',
  },
  delete: {
    width: '30px',
  },
};

const mobileItemStyle = {
  default: {
    width: '100%',
    padding: '0 0 0 76px',
  },
  qty: {
    width: '100%',
    padding: '0 0 0 76px',
  },
  delete: {
    width: '100%',
    padding: '0 0 0 76px',
    display: 'flex',
    flexDirection: 'row-reverse',
  },
};

export default function ReAddToCart(props: ShoppingProductsProps) {
  const {
    shoppingListInfo,
    products,
    successProducts,
    allowJuniorPlaceOrder,
    setValidateFailureProducts,
    setValidateSuccessProducts,
    textAlign = 'left',
    backendValidationEnabled,
  } = props;

  const { submitShoppingListPermission } = useAppSelector(rolePermissionSelector);

  const b3Lang = useB3Lang();
  const [isOpen, setOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [isMobile] = useMobile();

  const { decimal_places: decimalPlaces = 2 } = useAppSelector(activeCurrencyInfoSelector);

  useEffect(() => {
    if (products.length > 0) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [products]);

  const itemStyle = isMobile ? mobileItemStyle : defaultItemStyle;

  const handleUpdateProductQty = async (
    index: number,
    value: number | string,
    isValid: boolean,
  ) => {
    const newProduct: ProductsProps[] = [...products];
    newProduct[index].node.quantity = Number(value);
    newProduct[index].isValid = isValid;
    const calculateProduct = await setModifierQtyPrice(newProduct[index].node, Number(value));
    if (calculateProduct) {
      (newProduct[index] as CustomFieldItems).node = calculateProduct;
      setValidateFailureProducts(newProduct);
    }
  };

  const handleCancelClicked = () => {
    setOpen(false);
    setValidateFailureProducts([]);
    setValidateSuccessProducts([]);
  };

  const deleteProduct = (index: number) => {
    const newProduct: ProductsProps[] = [...products];
    newProduct.splice(index, 1);
    setValidateFailureProducts(newProduct);
  };

  // Call webhook to update cart prices for re-added products
  const callUpdateCartPricesWebhook = async (cartId: string, products: ProductsProps[]) => {
    try {
      const cartInfo = await getCart(cartId);

      const lineItems = (cartInfo?.data?.site?.cart?.lineItems?.physicalItems || []) as Array<{
        entityId: string;
        sku: string;
        productEntityId: number;
        variantEntityId: number;
        name: string;
        quantity: number;
        originalPrice: {
          value: number;
        };
        [key: string]: any;
      }>;

      if (lineItems.length === 0) {
        console.warn('[Re-Add to Cart Webhook] No line items found in cart');
        return;
      }

      const authToken = WEBHOOK_CONFIG.AUTH_TOKEN;
      const webhookUrl = getWebhookUrl(WEBHOOK_CONFIG.ENDPOINTS.UPDATE_CART_PRICE_B2B);

      // Build array of all cart items for batch webhook call
      const cart_items = products
        .map((item) => {
          const { node } = item;
          
          const cartLineItem = lineItems.find(
            (lineItem) => 
              lineItem.sku === node.variantSku || 
              lineItem.productEntityId === node.productId
          );

          if (!cartLineItem) {
            console.warn(`[Re-Add to Cart Webhook] No matching cart line item found for product: ${node.productName} (SKU: ${node.variantSku})`);
            return null;
          }

          return {
            item_id: cartLineItem.entityId || '',
            product_id: node.productId,
            variant_id: node.variantId,
            sku: node.variantSku,
            name: node.productName,
            quantity: Number(node.quantity) || 1,
            epicor_price: Number(node.basePrice) || 0,
            original_price: Number(node.basePrice) || 0,
          };
        })
        .filter((item) => item !== null);

      if (cart_items.length === 0) {
        console.warn('[Re-Add to Cart Webhook] No valid cart items to send');
        return;
      }

      // Send all items in a single webhook call
      const webhookBody = {
        action: 'update_cart_prices',
        cart_id: cartId,
        cart_items: cart_items,
        store_hash: storeHash,
        auth_token: authToken,
        total_items: cart_items.length,
      };

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookBody),
        });

        if (!response.ok) {
          let errorMessage = `Webhook error: ${response.status}`;
          try {
            const errorData = await response.text();
            if (errorData) {
              errorMessage += ` - ${errorData}`;
              console.error('[Re-Add to Cart Webhook] Error response body:', errorData);
            }
          } catch (parseError) {
            // Ignore if we can't parse the error
          }
          throw new Error(errorMessage);
        }

        const responseData = await response.json();
        
        // Calculate dynamic delay based on number of products: 2 seconds per product
        // 5 products = 10 sec, 10 products = 20 sec, 15 products = 30 sec, 20 products = 40 sec
        const productCount = cart_items.length;
        const delaySeconds = productCount * 2;
        const delayMilliseconds = delaySeconds * 1000;
        
        // Wait dynamically based on product count after webhook response
        await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
        
        return responseData;
      } catch (error) {
        console.error('[Re-Add to Cart Webhook] Error calling webhook:', error);
        b2bLogger.error('Error calling update cart prices webhook:', error);
        throw error;
      }
    } catch (error) {
      console.error('[Re-Add to Cart Webhook] Error in webhook call:', error);
      b2bLogger.error('Error updating cart prices:', error);
      throw error;
    }
  };

  const shouldRedirectToCheckout = () => {
    handleCancelClicked();
    if (
      allowJuniorPlaceOrder &&
      submitShoppingListPermission &&
      shoppingListInfo?.status === ShoppingListStatus.Approved
    ) {
      window.location.href = CHECKOUT_URL;
    } else {
      snackbar.success(b3Lang('shoppingList.reAddToCart.productsAdded'), {
        action: {
          label: b3Lang('shoppingList.reAddToCart.viewCart'),
          onClick: () => {
            if (window.b2b.callbacks.dispatchEvent('on-click-cart-button')) {
              window.location.href = CART_URL;
            }
          },
        },
      });
      b3TriggerCartNumber();
    }
  };

  const handlePrimaryAction = async () => {
    const isValidate = products.every((item: ProductsProps) => item.isValid);

    if (!isValidate) {
      snackbar.error(b3Lang('shoppingList.reAddToCart.fillCorrectQuantity'));
      return;
    }
    try {
      setLoading(true);

      const lineItems = addLineItems(products);

      const res = await createOrUpdateExistingCart(lineItems);

      if (!res.errors) {
        // Get cart ID after adding to cart
        const cartId =
          res?.data?.cart?.createCart?.cart?.entityId ||
          res?.data?.cart?.addCartLineItems?.cart?.entityId ||
          Cookies.get('cartId') ||
          '';

        // Call webhook after adding to cart
        if (cartId && products.length > 0) {
          try {
            await callUpdateCartPricesWebhook(cartId, products);
          } catch (webhookError) {
            console.error('[Re-Add to Cart] Webhook error:', webhookError);
          }
        }

        // Stop loader and show view cart after webhook completes
        setLoading(false);
        shouldRedirectToCheckout();
      }

      if (res.errors) {
        setLoading(false);
        snackbar.error(res.message);
      }

      b3TriggerCartNumber();
    } catch (error) {
      setLoading(false);
      console.error('[Re-Add to Cart] Error in add to cart process:', error);
    }
  };

  const handleReAddToCartBackend = async () => {
    setLoading(true);

    try {
      const lineItems = addLineItems(products);
      const res = await createOrUpdateExistingCart(lineItems);

      if (!res.errors) {
        // Get cart ID after adding to cart
        const cartId =
          res?.data?.cart?.createCart?.cart?.entityId ||
          res?.data?.cart?.addCartLineItems?.cart?.entityId ||
          Cookies.get('cartId') ||
          '';

        // Call webhook after adding to cart
        if (cartId && products.length > 0) {
          try {
            await callUpdateCartPricesWebhook(cartId, products);
          } catch (webhookError) {
            console.error('[Re-Add to Cart] Webhook error:', webhookError);
          }
        }

        // Stop loader and show view cart after webhook completes
        setLoading(false);
        shouldRedirectToCheckout();
      }

      b3TriggerCartNumber();
    } catch (e: unknown) {
      setLoading(false);
      if (e instanceof Error) {
        snackbar.error(e.message);
      }
    }
  };

  const addOrProceedToCheckout = async () => {
    if (backendValidationEnabled) {
      await handleReAddToCartBackend();
    } else {
      handlePrimaryAction();
    }
  };

  // this need the information of the SearchGraphlQuery endpoint change
  const handleClearNoStock = async () => {
    const newProduct = products.filter(
      (item: ProductsProps) => item.isStock === '0' || item.stock !== 0,
    );
    const requestArr: Promise<any>[] = [];
    newProduct.forEach((product) => {
      const item = product;
      const {
        node: { quantity },
        minQuantity = 0,
        maxQuantity = 0,
        isStock,
        stock,
      } = product;

      const quantityNumber = parseInt(`${quantity}`, 10) || 0;
      if (minQuantity !== 0 && quantityNumber < minQuantity) {
        item.node.quantity = minQuantity;
      } else if (maxQuantity !== 0 && quantityNumber > maxQuantity) {
        item.node.quantity = maxQuantity;
      }
      if (isStock !== '0' && stock && (quantity ? Number(quantity) : 0) > stock) {
        item.node.quantity = stock;
      }

      item.isValid = true;

      const qty = product?.node?.quantity ? Number(product.node.quantity) : 0;

      requestArr.push(setModifierQtyPrice(product.node, qty));
    });

    const productArr = await Promise.all(requestArr);

    productArr.forEach((item, index) => {
      newProduct[index].node = item;
    });
    setValidateFailureProducts(newProduct);
  };

  return (
    <B3Dialog
      isOpen={isOpen}
      handleLeftClick={handleCancelClicked}
      handRightClick={addOrProceedToCheckout}
      title={
        allowJuniorPlaceOrder
          ? b3Lang('shoppingList.reAddToCart.proceedToCheckout')
          : b3Lang('shoppingList.reAddToCart.addToCart')
      }
      rightSizeBtn={
        allowJuniorPlaceOrder
          ? b3Lang('shoppingList.reAddToCart.proceedToCheckout')
          : b3Lang('shoppingList.reAddToCart.addToCart')
      }
      maxWidth="xl"
    >
      <Grid>
        <Box
          sx={{
            m: '0 0 1rem 0',
          }}
        >
          {successProducts > 0 && (
            <Alert variant="filled" severity="success">
              {allowJuniorPlaceOrder
                ? b3Lang('shoppingList.reAddToCart.productsCanCheckout', {
                    successProducts,
                  })
                : b3Lang('shoppingList.reAddToCart.productsAddedToCart', {
                    successProducts,
                  })}
            </Alert>
          )}
        </Box>

        <Box
          sx={{
            m: '1rem 0',
          }}
        >
          {products.length > 0 && (
            <Alert variant="filled" severity="error">
              {allowJuniorPlaceOrder
                ? b3Lang('shoppingList.reAddToCart.productsCantCheckout', {
                    quantity: products.length,
                  })
                : b3Lang('shoppingList.reAddToCart.productsNotAddedToCart', {
                    quantity: products.length,
                  })}
            </Alert>
          )}
        </Box>
        <B3Spin isSpinning={loading} size={16} isFlex={false}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              margin: '0.5rem 0 1rem 0',
            }}
          >
            <Box
              sx={{
                fontSize: '24px',
              }}
            >
              {b3Lang('shoppingList.reAddToCart.productCount', {
                quantity: products.length,
              })}
            </Box>
            <CustomButton onClick={() => handleClearNoStock()}>
              {b3Lang('shoppingList.reAddToCart.adjustQuantity')}
            </CustomButton>
          </Box>

          {products.length > 0 ? (
            <Box>
              {!isMobile && (
                <Flex isHeader isMobile={isMobile}>
                  <FlexItem>
                    <ProductHead>{b3Lang('shoppingList.reAddToCart.product')}</ProductHead>
                  </FlexItem>
                  <FlexItem {...itemStyle.default} textAlignLocation={textAlign}>
                    <ProductHead>{b3Lang('shoppingList.reAddToCart.price')}</ProductHead>
                  </FlexItem>
                  <FlexItem
                    sx={{
                      justifyContent: 'center',
                    }}
                    {...itemStyle.default}
                    textAlignLocation={textAlign}
                  >
                    <ProductHead>{b3Lang('shoppingList.reAddToCart.quantity')}</ProductHead>
                  </FlexItem>
                  <FlexItem {...itemStyle.default} textAlignLocation={textAlign}>
                    <ProductHead>{b3Lang('shoppingList.reAddToCart.total')}</ProductHead>
                  </FlexItem>
                  <FlexItem {...itemStyle.delete}>
                    <ProductHead> </ProductHead>
                  </FlexItem>
                </Flex>
              )}
              {products.map((product: ProductsProps, index: number) => {
                const { isStock, maxQuantity, minQuantity, stock, node } = product;

                const {
                  quantity = 1,
                  primaryImage,
                  productName,
                  variantSku,
                  optionList,
                  productsSearch,
                  basePrice,
                } = product.node;

                const price = Number(basePrice);
                const total = (price * (quantity ? Number(quantity) : 0)).toFixed(decimalPlaces);

                const newProduct: any = {
                  ...productsSearch,
                  selectOptions: optionList,
                };

                const productFields = getProductOptionsFields(newProduct, {});

                const newOptionList = JSON.parse(optionList);
                const optionsValue: CustomFieldItems[] = productFields.filter(
                  (item) => item.valueText,
                );

                return (
                  <Flex isMobile={isMobile} key={variantSku}>
                    <FlexItem>
                      <ProductImage src={primaryImage || PRODUCT_DEFAULT_IMAGE} />
                      <Box
                        sx={{
                          marginLeft: '16px',
                        }}
                      >
                        <Typography variant="body1" color="#212121">
                          {productName}
                        </Typography>
                        <Typography variant="body1" color="#616161">
                          {variantSku}
                        </Typography>
                        {newOptionList.length > 0 &&
                          optionsValue.length > 0 &&
                          optionsValue.map((option: CustomFieldItems) => (
                            <Typography
                              sx={{
                                fontSize: '0.75rem',
                                lineHeight: '1.5',
                                color: '#455A64',
                              }}
                              key={option.valueLabel}
                            >
                              {`${option.valueLabel}: ${option.valueText}`}
                            </Typography>
                          ))}
                      </Box>
                    </FlexItem>
                    <FlexItem {...itemStyle.default} textAlignLocation={textAlign}>
                      {isMobile && <span>Price: </span>}
                      {currencyFormat(price)}
                    </FlexItem>
                    <FlexItem {...itemStyle.default} textAlignLocation={textAlign}>
                      <B3QuantityTextField
                        isStock={isStock}
                        maxQuantity={maxQuantity || node.productsSearch?.orderQuantityMaximum}
                        minQuantity={minQuantity || node.productsSearch?.orderQuantityMinimum}
                        stock={stock}
                        value={quantity}
                        onChange={(value, isValid) => {
                          handleUpdateProductQty(index, value, isValid);
                        }}
                      />
                    </FlexItem>
                    <FlexItem {...itemStyle.default} textAlignLocation={textAlign}>
                      {isMobile && <div>Total: </div>}
                      {currencyFormat(total)}
                    </FlexItem>

                    <FlexItem {...itemStyle.delete}>
                      <Delete
                        sx={{
                          cursor: 'pointer',
                          color: 'rgba(0, 0, 0, 0.54)',
                        }}
                        onClick={() => {
                          deleteProduct(index);
                        }}
                      />
                    </FlexItem>
                  </Flex>
                );
              })}
            </Box>
          ) : null}
        </B3Spin>
      </Grid>
    </B3Dialog>
  );
}
