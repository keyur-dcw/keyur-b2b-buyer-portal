import { useEffect, useState } from 'react';
import { FieldValues, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import Cookies from 'js-cookie';

import { B3CustomForm } from '@/components';
import B3Dialog from '@/components/B3Dialog';
import { CART_URL, WEBHOOK_CONFIG, getWebhookUrl } from '@/constants';
import { useMobile } from '@/hooks/useMobile';
import { useB3Lang } from '@/lib/lang';
import {
  addProductToBcShoppingList,
  addProductToShoppingList,
  getVariantInfoBySkus,
} from '@/shared/service/b2b';
import { getCart } from '@/shared/service/bc/graphql/cart';
import { isB2BUserSelector, useAppSelector } from '@/store';
import { BigCommerceStorefrontAPIBaseURL, snackbar } from '@/utils';
import b2bLogger from '@/utils/b3Logger';
import { storeHash } from '@/utils/basicConfig';
import b3TriggerCartNumber from '@/utils/b3TriggerCartNumber';
import { createOrUpdateExistingCart } from '@/utils/cartUtils';

import { EditableProductItem, OrderProductItem } from '../../../types';
import getReturnFormFields from '../shared/config';

import CreateShoppingList from './CreateShoppingList';
import OrderCheckboxProduct from './OrderCheckboxProduct';
import OrderShoppingList from './OrderShoppingList';

interface ReturnListProps {
  returnId: number;
  returnQty: number;
}

interface DialogData {
  dialogTitle: string;
  type: string;
  description: string;
  confirmText: string;
}

interface OrderDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  products?: OrderProductItem[];
  type?: string;
  currentDialogData?: DialogData;
  itemKey: string;
  orderId: number;
}

interface ReturnListProps {
  returnId: number;
  returnQty: number;
}

const getXsrfToken = (): string | undefined => {
  const token = Cookies.get('XSRF-TOKEN');

  if (!token) {
    return undefined;
  }

  return decodeURIComponent(token);
};

export default function OrderDialog({
  open,
  products = [],
  type,
  currentDialogData = undefined,
  setOpen,
  itemKey,
  orderId,
}: OrderDialogProps) {
  const navigate = useNavigate();
  const isB2BUser = useAppSelector(isB2BUserSelector);
  const [isOpenCreateShopping, setOpenCreateShopping] = useState(false);
  const [openShoppingList, setOpenShoppingList] = useState(false);
  const [editableProducts, setEditableProducts] = useState<EditableProductItem[]>([]);
  const [variantInfoList, setVariantInfoList] = useState<CustomFieldItems[]>([]);
  const [isRequestLoading, setIsRequestLoading] = useState(false);
  const [checkedArr, setCheckedArr] = useState<number[]>([]);
  const [returnArr, setReturnArr] = useState<ReturnListProps[]>([]);

  const [returnFormFields] = useState(getReturnFormFields());

  const [isMobile] = useMobile();

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors },
    setValue,
  } = useForm({
    mode: 'all',
  });
  const b3Lang = useB3Lang();

  const handleClose = () => {
    setOpen(false);
  };

  const sendReturnRequest = async (
    returnReason: FieldValues,
    returnArr: ReturnListProps[],
    orderId: number,
  ) => {
    if (!Object.keys(returnReason).length || !returnArr.length) {
      snackbar.error(b3Lang('purchasedProducts.error.selectOneItem'));
      return;
    }
    const transformedData = returnArr.reduce((result, item) => {
      const resultedData = result;
      const key = `return_qty[${item.returnId}]`;
      resultedData[key] = item.returnQty;
      return result;
    }, returnReason);
    transformedData.authenticity_token = getXsrfToken();
    transformedData.order_id = orderId;

    const urlencoded = new URLSearchParams(transformedData);

    const requestOptions: any = {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      referrer: `${BigCommerceStorefrontAPIBaseURL}/account.php?action=new_return&order_id=${orderId}`,
      body: urlencoded,
      mode: 'no-cors',
    };

    try {
      setIsRequestLoading(true);
      const returnResult = await fetch(
        `${BigCommerceStorefrontAPIBaseURL}/account.php?action=save_new_return`,
        requestOptions,
      );
      if (returnResult.status === 200 && returnResult.url.includes('saved_new_return')) {
        snackbar.success(b3Lang('purchasedProducts.success.successfulApplication'));
      } else {
        snackbar.error('purchasedProducts.error.failedApplication');
      }
      setIsRequestLoading(false);
      handleClose();
    } catch (err) {
      b2bLogger.error(err);
    }
  };

  const handleReturn = () => {
    handleSubmit((data) => {
      sendReturnRequest(data, returnArr, orderId);
    })();
  };

  const validateProductNumber = (variantInfoList: CustomFieldItems, skus: string[]) => {
    let isValid = true;

    skus.forEach((sku) => {
      const variantInfo: CustomFieldItems | null = (variantInfoList || []).find(
        (variant: CustomFieldItems) => variant.variantSku.toUpperCase() === sku.toUpperCase(),
      );
      const product = editableProducts.find((product) => product.sku === sku);
      if (!variantInfo || !product) {
        return;
      }

      const { maxQuantity = 0, minQuantity = 0, stock = 0, isStock = '0' } = variantInfo;

      const quantity = product?.editQuantity || 1;

      if (isStock === '1' && quantity > stock) {
        product.helperText = b3Lang('purchasedProducts.outOfStock');
        isValid = false;
      } else if (minQuantity !== 0 && quantity < minQuantity) {
        product.helperText = b3Lang('purchasedProducts.minQuantity', {
          minQuantity,
        });
        isValid = false;
      } else if (maxQuantity !== 0 && quantity > maxQuantity) {
        product.helperText = b3Lang('purchasedProducts.maxQuantity', {
          maxQuantity,
        });
        isValid = false;
      } else {
        product.helperText = '';
      }
    });

    if (!isValid) {
      setEditableProducts([...editableProducts]);
    }

    return isValid;
  };

  // Call webhook to update cart prices for re-ordered products
  const callUpdateCartPricesWebhook = async (cartId: string, items: CustomFieldItems[]) => {
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
        console.warn('[Re-Order Webhook] No line items found in cart');
        return;
      }

      const authToken = WEBHOOK_CONFIG.AUTH_TOKEN;
      const webhookUrl = getWebhookUrl(WEBHOOK_CONFIG.ENDPOINTS.UPDATE_CART_PRICE_B2B);

      // Build array of all cart items for batch webhook call
      const cart_items = items
        .map((item) => {
          const cartLineItem = lineItems.find(
            (lineItem) =>
              (lineItem.productEntityId === item.productId &&
                lineItem.variantEntityId === item.variantId) ||
              lineItems.length === 1
          );

          if (!cartLineItem) {
            console.warn(
              `[Re-Order Webhook] No matching cart line item found for product: ${item.productId} variant: ${item.variantId}`,
            );
            return null;
          }

          return {
            item_id: cartLineItem.entityId || '',
            product_id: item.productId,
            variant_id: item.variantId,
            sku: cartLineItem.sku || '',
            name: cartLineItem.name || '',
            quantity: item.quantity || 1,
            epicor_price: cartLineItem.originalPrice?.value || 0,
            original_price: cartLineItem.originalPrice?.value || 0,
          };
        })
        .filter((item) => item !== null);

      if (cart_items.length === 0) {
        console.warn('[Re-Order Webhook] No valid cart items to send');
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
              console.error('[Re-Order Webhook] Error response body:', errorData);
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
        console.error('[Re-Order Webhook] Error calling webhook:', error);
        b2bLogger.error('Error calling update cart prices webhook:', error);
        throw error;
      }
    } catch (error) {
      console.error('[Re-Order Webhook] Error in webhook call:', error);
      b2bLogger.error('Error updating cart prices:', error);
      throw error;
    }
  };

  const handleReorder = async () => {
    setIsRequestLoading(true);

    try {
      const items: CustomFieldItems[] = [];
      const skus: string[] = [];
      editableProducts.forEach((product) => {
        if (checkedArr.includes(product.variant_id)) {
          items.push({
            quantity: parseInt(`${product.editQuantity}`, 10) || 1,
            productId: product.product_id,
            variantId: product.variant_id,
            optionSelections: (product.product_options || []).map((option) => ({
              optionId: option.product_option_id,
              optionValue: option.value,
            })),
            allOptions: product.product_options,
          });

          skus.push(product.sku);
        }
      });

      if (skus.length <= 0) {
        setIsRequestLoading(false);
        return;
      }

      if (!validateProductNumber(variantInfoList, skus)) {
        setIsRequestLoading(false);
        snackbar.error(b3Lang('purchasedProducts.error.fillCorrectQuantity'));
        return;
      }
      const res = await createOrUpdateExistingCart(items);

      const status = res && (res.data.cart.createCart || res.data.cart.addCartLineItems);

      if (status) {
        // Get cart ID after adding to cart
        const cartId =
          res?.data?.cart?.createCart?.cart?.entityId ||
          res?.data?.cart?.addCartLineItems?.cart?.entityId ||
          Cookies.get('cartId') ||
          '';

        // Call webhook after adding to cart
        if (cartId && items.length > 0) {
          try {
            await callUpdateCartPricesWebhook(cartId, items);
          } catch (webhookError) {
            console.error('[Re-Order] Webhook error:', webhookError);
          }
        }

        // Stop loader and show view cart after webhook completes
        setIsRequestLoading(false);
        
        setOpen(false);
        snackbar.success(b3Lang('orderDetail.reorder.productsAdded'), {
          action: {
            label: b3Lang('orderDetail.reorder.viewCart'),
            onClick: () => {
              if (window.b2b.callbacks.dispatchEvent('on-click-cart-button')) {
                window.location.href = CART_URL;
              }
            },
          },
        });
        b3TriggerCartNumber();
      } else if (res.errors) {
        setIsRequestLoading(false);
        snackbar.error(res.errors[0].message);
      }
    } catch (err) {
      setIsRequestLoading(false);
      if (err instanceof Error) {
        snackbar.error(err.message);
      } else if (typeof err === 'object' && err !== null && 'detail' in err) {
        const customError = err as { detail: string };
        snackbar.error(customError.detail);
      }
    }
  };

  const handleSaveClick = () => {
    if (checkedArr.length === 0) {
      snackbar.error(b3Lang('purchasedProducts.error.selectOneItem'));
    }

    if (type === 'shoppingList') {
      if (checkedArr.length === 0) {
        return;
      }
      handleClose();
      setOpenShoppingList(true);
    }

    if (type === 'reOrder') {
      handleReorder();
    }

    if (type === 'return') {
      handleReturn();
    }
  };

  const handleCreateShoppingClick = () => {
    setOpenCreateShopping(false);
    setOpenShoppingList(true);
  };

  const handleShoppingClose = () => {
    setOpenShoppingList(false);
  };

  const handleShoppingConfirm = async (id: string) => {
    setIsRequestLoading(true);
    try {
      const items = editableProducts.map((product) => {
        const {
          product_id: productId,
          variant_id: variantId,
          editQuantity,
          product_options: productOptions,
        } = product;

        return {
          productId: Number(productId),
          variantId,
          quantity: Number(editQuantity),
          optionList: productOptions.map((option) => {
            const { product_option_id: optionId, value: optionValue } = option;

            return {
              optionId: `attribute[${optionId}]`,
              optionValue,
            };
          }),
        };
      });
      const params = items.filter((item) => checkedArr.includes(Number(item.variantId)));

      const addToShoppingList = isB2BUser ? addProductToShoppingList : addProductToBcShoppingList;

      await addToShoppingList({
        shoppingListId: Number(id),
        items: params,
      });

      snackbar.success(b3Lang('orderDetail.addToShoppingList.productsAdded'), {
        action: {
          label: b3Lang('orderDetail.viewShoppingList'),
          onClick: () => {
            navigate(`/shoppingList/${id}`);
          },
        },
      });

      setOpenShoppingList(false);
    } finally {
      setIsRequestLoading(false);
    }
  };

  const handleOpenCreateDialog = () => {
    setOpenShoppingList(false);
    setOpenCreateShopping(true);
  };

  const handleCloseShoppingClick = () => {
    setOpenCreateShopping(false);
    setOpenShoppingList(true);
  };

  useEffect(() => {
    if (!open) return;
    setEditableProducts(
      products.map((item: OrderProductItem) => ({
        ...item,
        editQuantity: item.quantity,
      })),
    );

    const getVariantInfoByList = async () => {
      const visibleProducts = products.filter((item: OrderProductItem) => item?.isVisible);

      const visibleSkus = visibleProducts.map((product) => product.sku);

      if (visibleSkus.length === 0) return;

      const { variantSku: variantInfoList = [] } = await getVariantInfoBySkus(visibleSkus);

      setVariantInfoList(variantInfoList);
    };

    getVariantInfoByList();
  }, [isB2BUser, open, products]);

  const handleProductChange = (products: EditableProductItem[]) => {
    setEditableProducts(products);
  };

  return (
    <>
      <Box
        sx={{
          ml: 3,
          // cursor: 'pointer',
          width: '50%',
        }}
      >
        <B3Dialog
          isOpen={open}
          fullWidth
          handleLeftClick={handleClose}
          handRightClick={handleSaveClick}
          title={currentDialogData?.dialogTitle || ''}
          rightSizeBtn={currentDialogData?.confirmText || 'Save'}
          maxWidth="md"
          loading={isRequestLoading}
        >
          <Typography
            sx={{
              margin: isMobile ? '0 0 1rem' : '1rem 0',
            }}
          >
            {currentDialogData?.description || ''}
          </Typography>
          <OrderCheckboxProduct
            products={editableProducts}
            onProductChange={handleProductChange}
            setCheckedArr={setCheckedArr}
            setReturnArr={setReturnArr}
            textAlign={isMobile ? 'left' : 'right'}
            type={type}
          />

          {type === 'return' && (
            <>
              <Typography
                variant="body1"
                sx={{
                  margin: '20px 0',
                }}
              >
                {b3Lang('purchasedProducts.orderDialog.additionalInformation')}
              </Typography>
              <B3CustomForm
                formFields={returnFormFields}
                errors={errors}
                control={control}
                getValues={getValues}
                setValue={setValue}
              />
            </>
          )}
        </B3Dialog>
      </Box>
      {itemKey === 'order-summary' && (
        <OrderShoppingList
          isOpen={openShoppingList}
          dialogTitle={b3Lang('purchasedProducts.orderDialog.addToShoppingList')}
          onClose={handleShoppingClose}
          onConfirm={handleShoppingConfirm}
          onCreate={handleOpenCreateDialog}
          isLoading={isRequestLoading}
          setLoading={setIsRequestLoading}
        />
      )}
      {itemKey === 'order-summary' && (
        <CreateShoppingList
          open={isOpenCreateShopping}
          onChange={handleCreateShoppingClick}
          onClose={handleCloseShoppingClick}
        />
      )}
    </>
  );
}
