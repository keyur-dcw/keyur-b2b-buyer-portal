import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHoriz as MoreHorizIcon } from '@mui/icons-material';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { styled } from '@mui/material/styles';

import { useB3Lang } from '@/lib/lang';
import { rolePermissionSelector, useAppSelector } from '@/store';
import { InvoiceList } from '@/types/invoice';
import { snackbar } from '@/utils';
import { verifyLevelPermission } from '@/utils/b3CheckPermissions/check';
import { b2bPermissionsMap } from '@/utils/b3CheckPermissions/config';

import { getBigCommerceOrderMetaFields } from '@/shared/service/b2b/graphql/bigcommerceOrderMeta';
import b2bLogger from '@/utils/b3Logger';

import { gotoInvoiceCheckoutUrl } from '../utils/payment';
import { getInvoiceDownloadPDFUrl, handlePrintPDF } from '../utils/pdf';
import { triggerPdfDownload } from './triggerPdfDownload';

const StyledMenu = styled(Menu)(() => ({
  '& .MuiPaper-elevation': {
    boxShadow:
      '0px 1px 0px -1px rgba(0, 0, 0, 0.1), 0px 1px 6px rgba(0, 0, 0, 0.07), 0px 1px 4px rgba(0, 0, 0, 0.06)',
    borderRadius: '4px',
  },
}));

interface B3PulldownProps {
  row: InvoiceList;
  setIsRequestLoading: (bool: boolean) => void;
  setInvoiceId: (id: string) => void;
  handleOpenHistoryModal: (bool: boolean) => void;
  isCurrentCompany: boolean;
  invoicePay: boolean;
  epicorOrderNumbers?: Record<string, string>;
}

function B3Pulldown({
  row,
  setIsRequestLoading,
  setInvoiceId,
  handleOpenHistoryModal,
  isCurrentCompany,
  invoicePay,
  epicorOrderNumbers = {},
}: B3PulldownProps) {
  const platform = useAppSelector(({ global }) => global.storeInfo.platform);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPay, setIsPay] = useState<boolean>(true);

  const navigate = useNavigate();
  const b3Lang = useB3Lang();

  const { invoicePayPermission, purchasabilityPermission } = useAppSelector(rolePermissionSelector);
  const { getOrderPermission: getOrderPermissionCode } = b2bPermissionsMap;

  const [isCanViewOrder, setIsCanViewOrder] = useState<boolean>(false);

  const close = () => {
    setIsOpen(false);
  };

  const handleMoreActionsClick = () => {
    const { id } = row;
    setInvoiceId(id);
    setIsOpen(true);
  };

  // ============================
  // VIEW INVOICE (Preview PDF)
  // ============================
  const handleViewInvoice = async (isPayNow: boolean) => {
    const { id, orderNumber } = row;

    close();
    setIsRequestLoading(true);

    let epicorOrderNumber: string | null = null;

    if (orderNumber) {
      epicorOrderNumber = epicorOrderNumbers[orderNumber] || null;

      if (!epicorOrderNumber) {
        try {
          const integrationInfo = await getBigCommerceOrderMetaFields(orderNumber);
          epicorOrderNumber = integrationInfo?.EpicorErpOrderNumber || null;
        } catch (error) {
          b2bLogger.error('Error fetching Epicor order number:', error);
        }
      }
    }

    const pdfUrl = await handlePrintPDF(id, isPayNow, orderNumber, epicorOrderNumber);

    setIsRequestLoading(false);

    if (!pdfUrl) {
      snackbar.error('pdf url resolution error');
      return;
    }

    window.open(pdfUrl, '_blank', 'fullscreen=yes');
  };

  // ============================
  // VIEW ORDER
  // ============================
  const handleViewOrder = () => {
    const { orderNumber } = row;
    close();
    navigate(`/orderDetail/${orderNumber}`);
  };

  // ============================
  // PAY INVOICE
  // ============================
  const handlePay = async () => {
    close();

    const { openBalance, originalBalance, id } = row;

    const params = {
      lineItems: [
        {
          invoiceId: Number(id),
          amount: openBalance.value === '.' ? '0' : `${Number(openBalance.value)}`,
        },
      ],
      currency: openBalance?.code || originalBalance.code,
    };

    if (openBalance.value === '.' || Number(openBalance.value) === 0) {
      snackbar.error('The payment amount entered has an invalid value.');
      return;
    }

    await gotoInvoiceCheckoutUrl(params, platform, false);
  };

  // ============================
  // PAYMENT HISTORY
  // ============================
  const viewPaymentHistory = async () => {
    close();
    handleOpenHistoryModal(true);
  };

  // ============================
  // DOWNLOAD PDF (ALWAYS BLOB)
  // ============================
  const handleDownloadPDF = async () => {
    const { id, orderNumber } = row;

    close();
    setIsRequestLoading(true);

    try {
      let epicorOrderNumber: string | null = null;

      if (orderNumber) {
        epicorOrderNumber = epicorOrderNumbers[orderNumber] || null;

        if (!epicorOrderNumber) {
          try {
            const integrationInfo = await getBigCommerceOrderMetaFields(orderNumber);
            epicorOrderNumber = integrationInfo?.EpicorErpOrderNumber || null;
          } catch (error) {
            b2bLogger.error('Error fetching Epicor order number:', error);
          }
        }
      }

      const url = await getInvoiceDownloadPDFUrl(id, false, orderNumber, epicorOrderNumber);

      setIsRequestLoading(false);
      triggerPdfDownload(url, 'invoice.pdf');

    } catch (error) {
      b2bLogger.error('Error downloading PDF:', error);
      setIsRequestLoading(false);
      snackbar.error('Failed to download PDF');
    }
  };

  useEffect(() => {
    const { openBalance, orderUserId, companyInfo } = row;

    const payPermissions =
      Number(openBalance.value) > 0 && invoicePayPermission && purchasabilityPermission;

    const isPayInvoice = isCurrentCompany ? payPermissions : payPermissions && invoicePay;
    setIsPay(isPayInvoice);

    const viewOrderPermission = verifyLevelPermission({
      code: getOrderPermissionCode,
      companyId: Number(companyInfo.companyId),
      userId: Number(orderUserId),
    });

    setIsCanViewOrder(viewOrderPermission);
  }, []);

  return (
    <>
      <IconButton
        onClick={handleMoreActionsClick}
        ref={ref}
        aria-label={b3Lang('invoice.actions.moreActions')}
        aria-haspopup="menu"
      >
        <MoreHorizIcon />
      </IconButton>

      <StyledMenu
        id="basic-menu"
        anchorEl={ref.current}
        open={isOpen}
        onClose={close}
        MenuListProps={{
          'aria-labelledby': 'basic-button',
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={() =>
          handleViewInvoice(row.status !== 2 && invoicePayPermission && purchasabilityPermission)
        }>
          {b3Lang('invoice.actions.viewInvoice')}
        </MenuItem>

        {isCanViewOrder && (
          <MenuItem onClick={handleViewOrder}>
            {b3Lang('invoice.actions.viewOrder')}
          </MenuItem>
        )}

        {row.status !== 0 && (
          <MenuItem onClick={viewPaymentHistory}>
            {b3Lang('invoice.actions.viewPaymentHistory')}
          </MenuItem>
        )}

        {isPay && (
          <MenuItem onClick={handlePay}>
            {b3Lang('invoice.actions.pay')}
          </MenuItem>
        )}

        <MenuItem onClick={() =>
          handleViewInvoice(row.status !== 2 && invoicePayPermission && purchasabilityPermission)
        }>
          {b3Lang('invoice.actions.print')}
        </MenuItem>

        <MenuItem onClick={handleDownloadPDF}>
          {b3Lang('invoice.actions.download')}
        </MenuItem>
      </StyledMenu>
    </>
  );
}

export default B3Pulldown;
