import { useEffect, useState } from 'react';
import { UploadFile as UploadFileIcon } from '@mui/icons-material';
import { Box, Card, CardContent, Divider, Typography } from '@mui/material';

import { B3Upload } from '@/components';
import CustomButton from '@/components/button/CustomButton';
import { CART_URL } from '@/constants';
import { useBlockPendingAccountViewPrice } from '@/hooks/useBlockPendingAccountViewPrice';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useMobile } from '@/hooks/useMobile';
import { useB3Lang } from '@/lib/lang';
import { useAppSelector } from '@/store';
import { snackbar } from '@/utils';
import b2bLogger from '@/utils/b3Logger';
import b3TriggerCartNumber from '@/utils/b3TriggerCartNumber';
import { createOrUpdateExistingCart } from '@/utils/cartUtils';
import { getCart } from '@/shared/service/bc/graphql/cart';
import { storeHash } from '@/utils/basicConfig';
import Cookies from 'js-cookie';
import { WEBHOOK_CONFIG, getWebhookUrl } from '@/constants';

import { addCartProductToVerify } from '../utils';
import { isProductShowPriceEnabled } from '@/utils/productShowPrice';

import QuickAdd from './QuickAdd';
import SearchProduct from './SearchProduct';

export default function QuickOrderPad() {
  const [isMobile] = useMobile();
  const b3Lang = useB3Lang();

  const [isOpenBulkLoadCSV, setIsOpenBulkLoadCSV] = useState(false);
  const [productData, setProductData] = useState<CustomFieldItems>([]);
  const [addBtnText, setAddBtnText] = useState<string>('Add to cart');
  const [isLoading, setIsLoading] = useState(false);
  const [blockPendingAccountViewPrice] = useBlockPendingAccountViewPrice();
  const featureFlags = useFeatureFlags();
  const backendValidationEnabled =
    featureFlags['B2B-3318.move_stock_and_backorder_validation_to_backend'] ?? false;

  const companyStatus = useAppSelector(({ company }) => company.companyInfo.status);

  // Call webhook to update cart prices for products
  const callUpdateCartPricesWebhook = async (cartId: string, products: CustomFieldItems[]) => {
    try {
      // Get cart info to get line items with entityId
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
        console.warn('[Quick Order Webhook] No line items found in cart');
        return;
      }

      // Get webhook config from global constants
      const authToken = WEBHOOK_CONFIG.AUTH_TOKEN;
      const webhookUrl = getWebhookUrl(WEBHOOK_CONFIG.ENDPOINTS.UPDATE_CART_PRICE_B2B);

      // Build array of all cart items for batch webhook call
      const cart_items = products
        .map((product) => {
          // Find matching cart line item by productId and variantId
          // Try multiple matching strategies
          const productId = product.productId || product.id || 0;
          const variantId = product.variantId || product.products?.variantId || 0;
          const sku = product.sku || product.variantSku || product.products?.variantSku || '';

          let cartLineItem = lineItems.find(
            (lineItem) =>
              lineItem.productEntityId === productId && lineItem.variantEntityId === variantId,
          );

          // If not found, try matching by SKU
          if (!cartLineItem && sku) {
            cartLineItem = lineItems.find((lineItem) => lineItem.sku === sku);
          }

          // If still not found and only one item in cart, use it
          if (!cartLineItem && lineItems.length === 1) {
            cartLineItem = lineItems[0];
          }

          // If still not found, try matching by productId only (last resort)
          if (!cartLineItem && productId) {
            cartLineItem = lineItems.find((lineItem) => lineItem.productEntityId === productId);
          }

          if (!cartLineItem) {
            console.warn(
              `[Quick Order Webhook] No matching cart line item found for product: productId=${productId}, variantId=${variantId}, sku=${sku}`,
            );
            return null;
          }

          return {
            item_id: cartLineItem.entityId || '',
            product_id: product.productId || productId,
            variant_id: product.variantId || variantId,
            sku: cartLineItem.sku || sku || '',
            name: cartLineItem.name || '',
            quantity: product.quantity || 1,
            epicor_price: cartLineItem.originalPrice?.value || 0,
            original_price: cartLineItem.originalPrice?.value || 0,
          };
        })
        .filter((item) => item !== null);

      if (cart_items.length === 0) {
        console.warn('[Quick Order Webhook] No valid cart items to send');
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
          // Try to get error details from response
          let errorMessage = `Webhook error: ${response.status}`;
          try {
            const errorData = await response.text();
            if (errorData) {
              errorMessage += ` - ${errorData}`;
              console.error('[Quick Order Webhook] Error response body:', errorData);
            }
          } catch (parseError) {
            // Ignore if we can't parse the error
          }
          throw new Error(errorMessage);
        }

        const responseData = await response.json();
        
        return responseData;
      } catch (error) {
        console.error('[Quick Order Webhook] Error calling webhook:', error);
        console.error('[Quick Order Webhook] Request payload:', JSON.stringify(webhookBody, null, 2));
        b2bLogger.error('Error calling update cart prices webhook:', error);
        throw error;
      }
    } catch (error) {
      console.error('[Quick Order Webhook] Error in webhook call:', error);
      b2bLogger.error('Error updating cart prices:', error);
      throw error;
    }
  };

  const getSnackbarMessage = (res: any) => {
    if (res && !res.errors) {
      snackbar.success(b3Lang('purchasedProducts.quickOrderPad.productsAdded'), {
        action: {
          label: b3Lang('purchasedProducts.quickOrderPad.viewCart'),
          onClick: () => {
            if (window.b2b.callbacks.dispatchEvent('on-click-cart-button')) {
              window.location.href = CART_URL;
            }
          },
        },
      });
    } else {
      snackbar.error('Error has occurred');
    }
  };

  const addSingleProductToCart = async (product: CustomFieldItems) => {
    try {
      setIsLoading(true);
      const res = await createOrUpdateExistingCart([product]);

      if (res && res.errors) {
        snackbar.error(res.errors[0].message);
      } else {
        // Get cart ID after adding to cart
        let cartId =
          res?.data?.cart?.createCart?.cart?.entityId ||
          res?.data?.cart?.addCartLineItems?.cart?.entityId ||
          Cookies.get('cartId') ||
          '';

        // If no cart ID from response, wait a bit and get it from cookies
        if (!cartId) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms for cart to update
          cartId = Cookies.get('cartId') || '';
        }

        // Call webhook after adding to cart
        if (cartId) {
          try {
            // Transform product to webhook format if needed
            const webhookProduct = {
              productId: product.productId || product.id || 0,
              variantId: product.variantId || product.products?.variantId || 0,
              quantity: product.quantity || product.qty || 1,
              optionSelections: product.optionSelections || product.newSelectOptionList || [],
              allOptions: product.allOptions || [],
            };
            
            await callUpdateCartPricesWebhook(cartId, [webhookProduct]);
          } catch (webhookError) {
            console.error('[Quick Order] Webhook error:', webhookError);
          }
        }

        // Stop loader and show view cart after webhook completes
        setIsLoading(false);
        
        snackbar.success(b3Lang('purchasedProducts.quickOrderPad.productsAdded'), {
          action: {
            label: b3Lang('purchasedProducts.quickOrderPad.viewCart'),
            onClick: () => {
              if (window.b2b.callbacks.dispatchEvent('on-click-cart-button')) {
                window.location.href = CART_URL;
              }
            },
          },
        });
      }

      b3TriggerCartNumber();
    } catch (error) {
      console.error('[Quick Order] Error in addSingleProductToCart:', error);
      setIsLoading(false);
    }
  };

  const getValidProducts = async (products: CustomFieldItems[] | CustomFieldItems) => {
    const productsArray = Array.isArray(products) ? products : [products];
    const notPurchaseSku: string[] = [];
    const productItems: CustomFieldItems[] = [];
    const limitProduct: CustomFieldItems[] = [];
    const minLimitQuantity: CustomFieldItems[] = [];
    const maxLimitQuantity: CustomFieldItems[] = [];
    const outOfStock: string[] = [];
    const notShowPrice: string[] = [];

    for (const item of productsArray) {
      const { products: currentProduct, qty } = item;
      const {
        option,
        isStock,
        stock,
        purchasingDisabled,
        maxQuantity,
        minQuantity,
        variantSku,
        variantId,
        productId,
        modifiers,
      } = currentProduct;
      if (purchasingDisabled === '1' || purchasingDisabled) {
        notPurchaseSku.push(variantSku);
        continue;
      }

      const showPriceEnabled = await isProductShowPriceEnabled(productId);
      if (!showPriceEnabled) {
        notShowPrice.push(variantSku);
        continue;
      }

      if (isStock === '1' && stock === 0) {
        outOfStock.push(variantSku);
        continue;
      }

      if (isStock === '1' && stock > 0 && stock < Number(qty)) {
        limitProduct.push({
          variantSku,
          AvailableAmount: stock,
        });
        continue;
      }

      if (Number(minQuantity) > 0 && Number(qty) < Number(minQuantity)) {
        minLimitQuantity.push({
          variantSku,
          minQuantity,
        });

        continue;
      }

      if (Number(maxQuantity) > 0 && Number(qty) > Number(maxQuantity)) {
        maxLimitQuantity.push({
          variantSku,
          maxQuantity,
        });

        continue;
      }

      const optionsList = option.map((item: CustomFieldItems) => ({
        optionId: item.option_id,
        optionValue: item.id,
      }));

      productItems.push({
        productId: parseInt(productId, 10) || 0,
        variantId: parseInt(variantId, 10) || 0,
        quantity: Number(qty),
        optionSelections: optionsList,
        allOptions: modifiers,
      });
    }

    return {
      notPurchaseSku,
      productItems,
      limitProduct,
      minLimitQuantity,
      maxLimitQuantity,
      outOfStock,
      notShowPrice,
    };
  };

  const handleAddToCart = async (productsData: CustomFieldItems) => {
    setIsLoading(true);
    try {
      const { stockErrorFile, validProduct } = productsData;

      const {
        notPurchaseSku,
        productItems,
        limitProduct,
        minLimitQuantity,
        maxLimitQuantity,
        outOfStock,
        notShowPrice,
      } = await getValidProducts(validProduct);

      if (productItems.length > 0) {
        const res = await createOrUpdateExistingCart(productItems);

        // Get cart ID after adding to cart
        const cartId =
          res?.data?.cart?.createCart?.cart?.entityId ||
          res?.data?.cart?.addCartLineItems?.cart?.entityId ||
          Cookies.get('cartId') ||
          '';

        // Call webhook after adding to cart
        if (cartId && productItems.length > 0) {
          try {
            await callUpdateCartPricesWebhook(cartId, productItems);
          } catch (webhookError) {
            console.error('[Quick Order] Webhook error:', webhookError);
          }
        }

        // Stop loader and show view cart after webhook completes
        setIsLoading(false);
        getSnackbarMessage(res);
        b3TriggerCartNumber();
      }

      if (limitProduct.length > 0) {
        limitProduct.forEach((data: CustomFieldItems) => {
          snackbar.warning(
            b3Lang('purchasedProducts.quickOrderPad.notEnoughStock', {
              variantSku: data.variantSku,
            }),
            {
              description: b3Lang('purchasedProducts.quickOrderPad.availableAmount', {
                availableAmount: data.AvailableAmount,
              }),
            },
          );
        });
      }

      if (notPurchaseSku.length > 0) {
        snackbar.error(
          b3Lang('purchasedProducts.quickOrderPad.notPurchaseableSku', {
            notPurchaseSku: notPurchaseSku.join(','),
          }),
        );
      }

      if (outOfStock.length > 0 && stockErrorFile) {
        snackbar.error(
          b3Lang('purchasedProducts.quickOrderPad.outOfStockSku', {
            outOfStock: outOfStock.join(','),
          }),
          {
            action: {
              label: b3Lang('purchasedProducts.quickOrderPad.downloadErrorsCSV'),
              onClick: () => {
                window.location.href = stockErrorFile;
              },
            },
          },
        );
      }

      if (minLimitQuantity.length > 0) {
        minLimitQuantity.forEach((data: CustomFieldItems) => {
          snackbar.error(
            b3Lang('purchasedProducts.quickOrderPad.minQuantityMessage', {
              minQuantity: data.minQuantity,
              sku: data.variantSku,
            }),
          );
        });
      }

      if (maxLimitQuantity.length > 0) {
        maxLimitQuantity.forEach((data: CustomFieldItems) => {
          snackbar.error(
            b3Lang('purchasedProducts.quickOrderPad.maxQuantityMessage', {
              maxQuantity: data.maxQuantity,
              sku: data.variantSku,
            }),
          );
        });
      }

      if (notShowPrice.length > 0) {
        snackbar.error(
          b3Lang('purchasedProducts.quickOrderPad.showPriceDisabled', {
            skus: notShowPrice.join(', '),
          }),
        );
      }

      setIsOpenBulkLoadCSV(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCSVToCart = async (productsData: CustomFieldItems) => {
    setIsLoading(true);
    try {
      const { validProduct } = productsData;

      // Convert products to cart format
      const productItems = validProduct.map((item: CustomFieldItems) => ({
        productId: Number(item.products?.productId) || 0,
        variantId: Number(item.products?.variantId) || 0,
        quantity: Number(item.qty) || 0,
        optionSelections:
          item.products?.option?.map((opt: CustomFieldItems) => ({
            optionId: opt.option_id,
            optionValue: opt.id,
          })) || [],
        allOptions: item.products?.modifiers || [],
        variantSku: item.products?.variantSku,
      }));

      const allowedItems: typeof productItems = [];
      const blockedSkus: string[] = [];

      for (const item of productItems) {
        const showPriceEnabled = await isProductShowPriceEnabled(item.productId);
        if (showPriceEnabled) {
          allowedItems.push(item);
        } else {
          blockedSkus.push(item.variantSku || String(item.productId));
        }
      }

      if (blockedSkus.length > 0) {
        snackbar.error(
          b3Lang('purchasedProducts.quickOrderPad.showPriceDisabled', {
            skus: blockedSkus.join(', '),
          }),
        );
      }

      if (!allowedItems.length) {
        setIsOpenBulkLoadCSV(false);
        return;
      }

      const res = await createOrUpdateExistingCart(allowedItems);

      getSnackbarMessage(res);
      b3TriggerCartNumber();

      setIsOpenBulkLoadCSV(false);
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message;
        const { stockErrorFile } = productsData;
        // const sanitizedMessage = sanitizeErrorMessage(errorMessage);

        const isOutOfStock =
          errorMessage.toLowerCase().includes('out of stock') ||
          errorMessage.toLowerCase().includes('insufficient stock');

        if (isOutOfStock) {
          if (stockErrorFile) {
            snackbar.error(errorMessage, {
              action: {
                label: b3Lang('purchasedProducts.quickOrderPad.downloadErrorsCSV'),
                onClick: () => {
                  window.location.href = stockErrorFile;
                },
              },
            });
          } else {
            snackbar.error(errorMessage);
          }
        } else {
          // Show other cart API errors as they come
          snackbar.error(errorMessage);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSearchAddCart = async (product: CustomFieldItems) => {
    const currentProduct: CustomFieldItems = {
      node: {
        ...product,
        productsSearch: product,
      },
    };

    const isPassVerify = await addCartProductToVerify([currentProduct], b3Lang);

    try {
      if (isPassVerify) {
        await addSingleProductToCart(product);
      }
    } catch (error) {
      b2bLogger.error(error);
    }
  };

  const handleOpenUploadDiag = () => {
    if (blockPendingAccountViewPrice && companyStatus === 0) {
      snackbar.info(b3Lang('purchasedProducts.quickOrderPad.addNProductsToCart'));
    } else {
      setIsOpenBulkLoadCSV(true);
    }
  };

  const handleBackendQuickSearchAddToCart = async (product: CustomFieldItems) => {
    try {
      await addSingleProductToCart(product);
    } catch (e: unknown) {
      if (e instanceof Error) {
        snackbar.error(e.message);
      }
    }
  };

  useEffect(() => {
    if (productData?.length > 0) {
      setAddBtnText(
        b3Lang('purchasedProducts.quickOrderPad.addNProductsToCart', {
          quantity: productData.length,
        }),
      );
    }
  }, [b3Lang, productData]);

  return (
    <Card sx={{ marginBottom: isMobile ? '8.5rem' : '50px' }}>
      <CardContent>
        <Box>
          <Typography variant="h5" sx={{ marginBottom: '1rem' }}>
            {b3Lang('purchasedProducts.quickOrderPad.quickOrderPad')}
          </Typography>

          <SearchProduct
            addToList={
              backendValidationEnabled
                ? handleBackendQuickSearchAddToCart
                : handleQuickSearchAddCart
            }
          />

          <Divider />

          <QuickAdd />

          <Divider />

          <Box sx={{ margin: '20px 0 0' }}>
            <CustomButton variant="text" onClick={() => handleOpenUploadDiag()}>
              <UploadFileIcon sx={{ marginRight: '8px' }} />
              {b3Lang('purchasedProducts.quickOrderPad.bulkUploadCSV')}
            </CustomButton>
          </Box>
        </Box>
      </CardContent>

      <B3Upload
        isOpen={isOpenBulkLoadCSV}
        setIsOpen={setIsOpenBulkLoadCSV}
        handleAddToList={backendValidationEnabled ? handleAddCSVToCart : handleAddToCart}
        setProductData={setProductData}
        addBtnText={addBtnText}
        isLoading={isLoading}
        isToCart
      />
    </Card>
  );
}
