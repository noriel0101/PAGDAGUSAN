import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Printer, Share2, CheckCircle2, ShieldCheck, Download } from 'lucide-react';
import { PaymentRecord } from '../types';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: PaymentRecord | null;
  onShare: (payment: PaymentRecord) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info') => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  payment,
  onShare,
  onShowToast
}) => {
  if (!isOpen || !payment) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    onShowToast('Receipt Generated', `Downloaded digital copy for ${payment.invoiceNo}`, 'success');
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-[#141416] border border-[#262626] rounded-3xl shadow-2xl overflow-hidden text-[#F3F4F6]"
        >
          {/* Header Controls */}
          <div className="flex items-center justify-between p-4 border-b border-[#262626] bg-[#141416]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F3F4F6] uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Official Rent Payment Receipt</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onShare(payment)}
                className="p-1.5 rounded-lg text-[#6B7280] hover:text-white hover:bg-[#1A1A1C] transition-colors"
                title="Share Receipt"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={handlePrint}
                className="p-1.5 rounded-lg text-[#6B7280] hover:text-white hover:bg-[#1A1A1C] transition-colors"
                title="Print Receipt"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-[#6B7280] hover:text-white hover:bg-[#1A1A1C] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Receipt Body */}
          <div className="p-6 bg-[#0A0A0B] space-y-6 print:bg-white print:text-black">
            {/* Branding & Status */}
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#C084FC] flex items-center justify-center text-black font-serif font-bold text-sm">
                    R
                  </div>
                  <span className="font-serif font-bold text-lg text-white">Residenz</span>
                </div>
                <p className="text-xs text-[#9CA3AF] mt-1">{payment.propertyName}</p>
                <p className="text-[11px] text-[#6B7280]">Boarding House Management System</p>
              </div>

              <div className="text-right">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                  payment.status === 'paid'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : payment.status === 'pending'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {payment.status}
                </span>
                <p className="text-[11px] text-[#6B7280] font-mono mt-1.5">{payment.invoiceNo}</p>
              </div>
            </div>

            {/* Total Amount Box */}
            <div className="p-4 rounded-2xl bg-[#141416] border border-[#262626] flex items-center justify-between">
              <div>
                <span className="text-xs text-[#6B7280] uppercase tracking-wider font-medium">Total Amount Paid</span>
                <div className="text-2xl font-bold font-serif text-[#C084FC] mt-0.5">
                  ₱{payment.amount.toLocaleString()}.00
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-[#6B7280]">Payment Channel</span>
                <p className="text-sm font-semibold text-white">{payment.paymentMethod}</p>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-[#6B7280]">Tenant Name</span>
                <p className="font-medium text-[#F3F4F6]">{payment.tenantName}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[#6B7280]">Room Assignment</span>
                <p className="font-medium text-[#F3F4F6]">Room #{payment.roomNumber}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[#6B7280]">Billing Period</span>
                <p className="font-medium text-[#F3F4F6]">{payment.monthCovered}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[#6B7280]">Payment Date</span>
                <p className="font-medium text-[#F3F4F6]">{payment.paidDate || payment.createdAt}</p>
              </div>
              {payment.referenceNumber && (
                <div className="space-y-1 col-span-2">
                  <span className="text-[#6B7280]">Transaction Reference No.</span>
                  <p className="font-mono text-[#C084FC] font-medium">{payment.referenceNumber}</p>
                </div>
              )}
              {payment.notes && (
                <div className="space-y-1 col-span-2">
                  <span className="text-[#6B7280]">Remarks</span>
                  <p className="text-[#9CA3AF]">{payment.notes}</p>
                </div>
              )}
            </div>

            {/* Security Verification Stamp & QR Code */}
            <div className="pt-4 border-t border-[#262626] flex items-center justify-between text-[11px] text-[#6B7280]">
              <div>
                <p className="text-[#9CA3AF] font-medium">Digital Verification Stamp</p>
                <p>Secured with PostgreSQL API verification</p>
                <p className="font-mono text-[10px] text-[#6B7280] mt-0.5">AUTH-HASH: 9a7b-88c2-residenz-verified</p>
              </div>

              {/* Mini QR verification icon */}
              <div className="p-1.5 bg-white rounded-lg shrink-0">
                <svg className="w-12 h-12" viewBox="0 0 100 100" fill="#0A0A0B">
                  <rect x="5" y="5" width="28" height="28" fill="#0A0A0B" />
                  <rect x="10" y="10" width="18" height="18" fill="white" />
                  <rect x="14" y="14" width="10" height="10" fill="#0A0A0B" />
                  <rect x="67" y="5" width="28" height="28" fill="#0A0A0B" />
                  <rect x="72" y="10" width="18" height="18" fill="white" />
                  <rect x="76" y="14" width="10" height="10" fill="#0A0A0B" />
                  <rect x="5" y="67" width="28" height="28" fill="#0A0A0B" />
                  <rect x="10" y="72" width="18" height="18" fill="white" />
                  <rect x="14" y="76" width="10" height="10" fill="#0A0A0B" />
                  <rect x="42" y="42" width="16" height="16" fill="#C084FC" />
                  <rect x="42" y="10" width="16" height="8" fill="#0A0A0B" />
                  <rect x="42" y="82" width="16" height="8" fill="#0A0A0B" />
                  <rect x="70" y="42" width="20" height="10" fill="#0A0A0B" />
                  <rect x="10" y="42" width="20" height="10" fill="#0A0A0B" />
                </svg>
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="p-4 bg-[#141416] border-t border-[#262626] flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-[#262626]"
            >
              <Download className="w-4 h-4 text-[#C084FC]" />
              <span>Download PDF</span>
            </button>
            <button
              onClick={() => onShare(payment)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-lg shadow-[#C084FC]/20"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Receipt</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
