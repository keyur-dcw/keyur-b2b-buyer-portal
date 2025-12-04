import { SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Resizable } from 'react-resizable';
import { Box } from '@mui/material';
// cspell:disable-next-line
import PDFObject from 'pdfobject';

import { getBigCommerceOrderMetaFields } from '@/shared/service/b2b/graphql/bigcommerceOrderMeta';
import B3Spin from '@/components/spin/B3Spin';
import { snackbar } from '@/utils';
import b2bLogger from '@/utils/b3Logger';

import { handlePrintPDF } from '../utils/pdf';

interface RowList {
  id: string;
  createdAt: number;
  updatedAt: number;
  orderNumber?: string;
}

const templateMinHeight = 300;

interface PrintTemplateProps {
  row: RowList;
  epicorOrderNumbers?: Record<string, string>;
}

function PrintTemplate({ row, epicorOrderNumbers = {} }: PrintTemplateProps) {
  const container = useRef<HTMLInputElement | null>(null);

  const dom = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState<boolean>(false);

  const [height, setHeight] = useState<number>(templateMinHeight);

  const onFirstBoxResize = (
    _: SyntheticEvent<Element, Event>,
    { size }: { size: { height: number } },
  ) => {
    setHeight(size.height);
  };

  useEffect(() => {
    const viewPrint = async () => {
      setLoading(true);
      const { id: invoiceId, orderNumber } = row;

      // Get Epicor order number if available
      let epicorOrderNumber: string | null = null;
      if (orderNumber) {
        epicorOrderNumber = epicorOrderNumbers[orderNumber] || null;
        // If not in cache, try to fetch it
        if (!epicorOrderNumber) {
          try {
            const integrationInfo = await getBigCommerceOrderMetaFields(orderNumber);
            epicorOrderNumber = integrationInfo?.EpicorErpOrderNumber || null;
          } catch (error) {
            b2bLogger.error('Error fetching Epicor order number:', error);
          }
        }
      }

      // Always pass orderNumber (even if Epicor ID is not found, we need it for BigCommerce ID display)
      const invoicePDFUrl = await handlePrintPDF(
        invoiceId,
        false,
        orderNumber || undefined,
        epicorOrderNumber,
      );

      if (!invoicePDFUrl) {
        snackbar.error('pdf url resolution error');
        setLoading(false);
        return;
      }

      if (!container?.current) {
        setLoading(false);
        return;
      }

      // PDFObject.embed works with blob URLs
      // Ensure we have a valid URL (blob URL or regular URL)
      try {
        // Clear container first
        if (container.current) {
          container.current.innerHTML = '';
        }
        
        const embedResult = PDFObject.embed(invoicePDFUrl, container.current, {
          pdfOpenParams: {
            view: 'FitH',
            pagemode: 'none',
          },
        });
        
        if (!embedResult) {
          // If PDFObject.embed fails, try using an iframe as fallback
          const iframe = document.createElement('iframe');
          iframe.src = invoicePDFUrl;
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          if (container.current) {
            container.current.innerHTML = '';
            container.current.appendChild(iframe);
          }
        }
      } catch (embedError) {
        b2bLogger.error('Error embedding PDF:', embedError);
        // Fallback: use iframe
        const iframe = document.createElement('iframe');
        iframe.src = invoicePDFUrl;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        if (container.current) {
          container.current.innerHTML = '';
          container.current.appendChild(iframe);
        }
      }

      setLoading(false);
    };

    viewPrint();

    return () => {
      container.current = null;
    };
  }, [row, epicorOrderNumbers]);

  return (
    <B3Spin isSpinning={loading}>
      <Box
        ref={dom}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          width: '100%',
          '& .box': {
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
            '& .react-resizable': {
              position: 'relative',
            },
            '& .react-resizable-handle': {
              position: 'absolute',
              width: '100%',
              height: '30px',
              backgroundRepeat: 'no-repeat',
              backgroundOrigin: 'content-box',
              boxSizing: 'border-box',
            },
            '& .react-resizable-handle-s': {
              cursor: 'ns-resize',
              bottom: 0,
            },
          },
        }}
      >
        <Resizable
          className="box"
          height={height}
          minConstraints={[dom?.current?.offsetWidth || 0, 0]}
          width={dom.current?.offsetWidth || 0}
          onResize={onFirstBoxResize}
          resizeHandles={['s']}
        >
          <div style={{ width: '100%', height: `${height}px` }}>
            <div ref={container} style={{ height: '100%', width: '100%' }} />
          </div>
        </Resizable>
      </Box>
    </B3Spin>
  );
}

export default PrintTemplate;
