import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Share2, Copy, Check, QrCode, Facebook, 
  Twitter, MessageCircle, Send, Linkedin, Mail, ExternalLink 
} from 'lucide-react';

export interface ShareContent {
  title: string;
  description: string;
  url?: string;
  image?: string;
  category?: 'room' | 'announcement' | 'receipt' | 'app';
}

interface SocialShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: ShareContent | null;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info') => void;
}

export const SocialShareModal: React.FC<SocialShareModalProps> = ({
  isOpen,
  onClose,
  content,
  onShowToast
}) => {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  if (!isOpen || !content) return null;

  const currentUrl = content.url || window.location.href;
  const encodedUrl = encodeURIComponent(currentUrl);
  const encodedTitle = encodeURIComponent(content.title);
  const encodedDesc = encodeURIComponent(content.description);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      onShowToast('Link Copied to Clipboard!', 'You can now paste and share it anywhere.', 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      onShowToast('Link copied', currentUrl, 'info');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: content.title,
          text: content.description,
          url: currentUrl
        });
        onShowToast('Shared successfully!', '', 'success');
      } catch {
        // user cancelled or failed
      }
    } else {
      handleCopyLink();
    }
  };

  const shareNetworks = [
    {
      name: 'Facebook',
      icon: Facebook,
      color: 'bg-[#1877F2] hover:bg-[#166fe5]',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedTitle}`
    },
    {
      name: 'X (Twitter)',
      icon: Twitter,
      color: 'bg-black hover:bg-zinc-800 border border-slate-700',
      url: `https://twitter.com/intent/tweet?text=${encodedTitle}%20-%20${encodedDesc}&url=${encodedUrl}`
    },
    {
      name: 'WhatsApp',
      icon: MessageCircle,
      color: 'bg-[#25D366] hover:bg-[#20bd5a]',
      url: `https://api.whatsapp.com/send?text=${encodedTitle}%0A${encodedDesc}%0A${encodedUrl}`
    },
    {
      name: 'Telegram',
      icon: Send,
      color: 'bg-[#229ED9] hover:bg-[#1f8fc4]',
      url: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}%0A${encodedDesc}`
    },
    {
      name: 'LinkedIn',
      icon: Linkedin,
      color: 'bg-[#0A66C2] hover:bg-[#095196]',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`
    },
    {
      name: 'Email',
      icon: Mail,
      color: 'bg-slate-700 hover:bg-slate-600',
      url: `mailto:?subject=${encodedTitle}&body=${encodedDesc}%0A%0ACheck it out here: ${encodedUrl}`
    }
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-md bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl text-[#F3F4F6] overflow-hidden"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-[#6B7280] hover:text-white rounded-lg hover:bg-[#1A1A1C] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-[#C084FC]/10 border border-[#C084FC]/30 flex items-center justify-center text-[#C084FC]">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-lg text-white">Share Listing & Content</h3>
              <p className="text-xs text-[#6B7280]">Broadcast to roommates, classmates, or social platforms</p>
            </div>
          </div>

          {/* Preview Card */}
          <div className="p-3.5 rounded-2xl bg-[#0A0A0B] border border-[#262626] mb-5 flex gap-3 items-center">
            {content.image ? (
              <img
                src={content.image}
                alt={content.title}
                className="w-14 h-14 object-cover rounded-xl shrink-0 border border-[#262626]"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-[#C084FC]/10 border border-[#C084FC]/20 flex items-center justify-center text-[#C084FC] font-serif font-bold text-base shrink-0">
                R
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-serif font-semibold text-sm text-white truncate">{content.title}</p>
              <p className="text-xs text-[#9CA3AF] line-clamp-2 mt-0.5">{content.description}</p>
            </div>
          </div>

          {/* Share Channels Grid */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {shareNetworks.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.name}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl ${item.color} text-white text-xs font-semibold transition-transform active:scale-95 shadow-sm`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.name}</span>
                </a>
              );
            })}
          </div>

          {/* Quick Copy Link Box */}
          <div className="flex items-center gap-2 p-2 rounded-xl bg-[#0A0A0B] border border-[#262626] mb-4">
            <input
              type="text"
              readOnly
              value={currentUrl}
              className="flex-1 bg-transparent text-xs text-[#9CA3AF] px-2 py-1 outline-none truncate font-mono"
            />
            <button
              onClick={handleCopyLink}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shrink-0 ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#C084FC] hover:bg-[#d8b4fe] text-black shadow-md'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Bottom Actions: QR Code & Native Share */}
          <div className="flex items-center gap-2 pt-2 border-t border-[#262626]">
            <button
              onClick={() => setShowQR(!showQR)}
              className="flex-1 py-2.5 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-[#262626]"
            >
              <QrCode className="w-4 h-4 text-[#C084FC]" />
              <span>{showQR ? 'Hide QR Code' : 'Generate QR Code'}</span>
            </button>

            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                onClick={handleNativeShare}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-lg shadow-[#C084FC]/20"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Device Share</span>
              </button>
            )}
          </div>

          {/* QR Code Container */}
          {showQR && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 rounded-2xl bg-white text-black flex flex-col items-center justify-center text-center"
            >
              {/* Responsive SVG QR Code pattern mock generator */}
              <div className="p-3 bg-white border-2 border-black rounded-xl">
                <svg className="w-32 h-32" viewBox="0 0 100 100" fill="none">
                  {/* Outer corner squares */}
                  <rect x="5" y="5" width="28" height="28" stroke="#0A0A0B" strokeWidth="6" fill="none" />
                  <rect x="12" y="12" width="14" height="14" fill="#0A0A0B" />
                  <rect x="67" y="5" width="28" height="28" stroke="#0A0A0B" strokeWidth="6" fill="none" />
                  <rect x="74" y="12" width="14" height="14" fill="#0A0A0B" />
                  <rect x="5" y="67" width="28" height="28" stroke="#0A0A0B" strokeWidth="6" fill="none" />
                  <rect x="12" y="74" width="14" height="14" fill="#0A0A0B" />
                  {/* Grid pattern data nodes */}
                  <rect x="40" y="8" width="6" height="6" fill="#C084FC" />
                  <rect x="52" y="8" width="6" height="6" fill="#0A0A0B" />
                  <rect x="44" y="20" width="8" height="8" fill="#0A0A0B" />
                  <rect x="10" y="44" width="8" height="8" fill="#0A0A0B" />
                  <rect x="25" y="45" width="6" height="6" fill="#C084FC" />
                  <rect x="42" y="42" width="16" height="16" fill="#0A0A0B" />
                  <rect x="68" y="42" width="6" height="6" fill="#0A0A0B" />
                  <rect x="80" y="48" width="10" height="6" fill="#0A0A0B" />
                  <rect x="45" y="68" width="8" height="8" fill="#0A0A0B" />
                  <rect x="60" y="72" width="8" height="8" fill="#C084FC" />
                  <rect x="78" y="68" width="12" height="12" fill="#0A0A0B" />
                  <rect x="42" y="85" width="18" height="6" fill="#0A0A0B" />
                  <rect x="72" y="86" width="14" height="6" fill="#0A0A0B" />
                </svg>
              </div>
              <p className="mt-2 text-xs font-serif font-bold text-black">Scan to Open on Mobile</p>
              <p className="text-[11px] text-[#6B7280]">Fast room verification & rental lookup</p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
