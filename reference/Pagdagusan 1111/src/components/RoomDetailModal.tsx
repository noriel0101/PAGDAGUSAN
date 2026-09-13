import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, MapPin, Users, Star, ShieldCheck, Share2, 
  Calendar, Check, MessageSquare, Phone, Mail, Home, Eye
} from 'lucide-react';
import { RoomListing, UserProfile } from '../types';
import confetti from 'canvas-confetti';

interface RoomDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomListing | null;
  currentUser: UserProfile | null;
  onShare: (room: RoomListing) => void;
  onBookInquiry: (room: RoomListing, bookingDetails: { date: string; message: string; contact: string }) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info') => void;
}

export const RoomDetailModal: React.FC<RoomDetailModalProps> = ({
  isOpen,
  onClose,
  room,
  currentUser,
  onShare,
  onBookInquiry,
  onShowToast
}) => {
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  const [showInquiryForm, setShowInquiryForm] = useState(false);
  const [moveInDate, setMoveInDate] = useState('');
  const [inquiryMsg, setInquiryMsg] = useState('');
  const [contactNumber, setContactNumber] = useState(currentUser?.phone || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [is360Active, setIs360Active] = useState(false);

  if (!isOpen || !room) return null;

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveInDate) {
      onShowToast('Move-in date required', 'Please select your target move-in date', 'info');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      onBookInquiry(room, {
        date: moveInDate,
        message: inquiryMsg || 'Interested in renting this room.',
        contact: contactNumber || '+63 900 000 0000'
      });
      setIsSubmitting(false);
      setShowInquiryForm(false);
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
      onShowToast(
        'Reservation Inquiry Sent!',
        `Your booking request for Room #${room.roomNumber} was dispatched to ${room.ownerName}.`,
        'success'
      );
    }, 600);
  };

  const isAvailable = room.status === 'available' && room.occupiedCount < room.capacity;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-[#0A0A0B]/85 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 20 }}
          className="relative w-full max-w-4xl bg-[#141416] border border-[#262626] rounded-3xl shadow-2xl overflow-hidden text-[#F3F4F6] my-auto max-h-[92vh] flex flex-col"
        >
          {/* Top Bar Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#262626] bg-[#141416] shrink-0">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg text-xs font-semibold uppercase bg-[#C084FC]/10 text-[#C084FC] border border-[#C084FC]/30">
                {room.roomType}
              </span>
              <span className="text-xs text-[#6B7280]">Room #{room.roomNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onShare(room)}
                className="p-2 rounded-xl text-[#9CA3AF] hover:text-white bg-[#1A1A1C] hover:bg-[#262626] transition-colors flex items-center gap-1.5 text-xs font-medium border border-[#262626]"
                title="Share Room"
              >
                <Share2 className="w-4 h-4 text-[#C084FC]" />
                <span className="hidden sm:inline">Share</span>
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-[#6B7280] hover:text-white bg-[#1A1A1C] hover:bg-[#262626] transition-colors border border-[#262626]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable Content Body */}
          <div className="overflow-y-auto p-6 space-y-6 flex-1">
            {/* Gallery Section */}
            <div className="space-y-3">
              <div className="relative rounded-2xl overflow-hidden aspect-video sm:aspect-[21/9] bg-[#0A0A0B] border border-[#262626] group">
                <img
                  src={room.photos[selectedPhotoIdx] || room.photos[0]}
                  alt={room.title}
                  className={`w-full h-full object-cover transition-all duration-500 ${is360Active ? 'scale-110 blur-[1px]' : 'group-hover:scale-105'}`}
                />
                
                {/* 360 virtual simulation badge */}
                <button
                  onClick={() => setIs360Active(!is360Active)}
                  className="absolute top-4 left-4 px-3 py-1.5 rounded-xl bg-[#0A0A0B]/85 backdrop-blur-md border border-[#262626] text-white text-xs font-medium flex items-center gap-1.5 shadow-lg hover:bg-[#141416] transition-colors"
                >
                  <Eye className="w-3.5 h-3.5 text-[#C084FC] animate-pulse" />
                  <span>{is360Active ? 'Exit 360° View' : '360° Virtual Preview'}</span>
                </button>

                <div className="absolute bottom-4 right-4 px-3 py-1 rounded-lg bg-[#0A0A0B]/85 backdrop-blur-md text-xs text-[#9CA3AF] border border-[#262626]">
                  {selectedPhotoIdx + 1} of {room.photos.length} Photos
                </div>

                {is360Active && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px] pointer-events-none">
                    <div className="text-center p-4 rounded-2xl bg-[#0A0A0B]/95 border border-[#C084FC]/40 text-xs text-[#F3F4F6] max-w-xs shadow-2xl">
                      <p className="font-semibold text-[#C084FC] mb-1">Interactive 360° Panoramic View</p>
                      <p className="text-[#9CA3AF] text-[11px]">Simulating ultra-wide walkthrough of Room #{room.roomNumber} interior & study bay.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Thumbnails */}
              {room.photos.length > 1 && (
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {room.photos.map((photo, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedPhotoIdx(idx);
                        setIs360Active(false);
                      }}
                      className={`relative w-20 h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all ${
                        selectedPhotoIdx === idx ? 'border-[#C084FC] scale-105' : 'border-[#262626] opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={photo} alt="thumbnail" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Room Title, Location & Price */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#262626]">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold font-serif text-white">{room.title}</h2>
                <div className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                  <MapPin className="w-4 h-4 text-[#C084FC] shrink-0" />
                  <span>{room.address}, {room.city}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#9CA3AF] pt-1">
                  <div className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="font-semibold text-white">{room.rating}</span>
                    <span className="text-[#6B7280]">({room.reviewsCount} reviews)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-sky-400" />
                    <span>Capacity: {room.capacity} ({room.occupiedCount}/{room.capacity} Occupied)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{room.genderPreference}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#0A0A0B] border border-[#262626] text-right sm:min-w-[180px]">
                <span className="text-xs text-[#6B7280]">Monthly Rent</span>
                <div className="text-2xl font-bold font-serif text-[#C084FC]">
                  ₱{room.priceMonthly.toLocaleString()}
                  <span className="text-xs font-normal text-[#6B7280]">/mo</span>
                </div>
                <p className="text-[11px] text-[#6B7280] mt-0.5">Deposit: ₱{room.depositAmount.toLocaleString()}</p>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white">About this Accommodation</h3>
              <p className="text-xs sm:text-sm text-[#9CA3AF] leading-relaxed">{room.description}</p>
            </div>

            {/* Amenities Grid */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Included Amenities & Services</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {room.amenities.map((amenity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2.5 p-3 rounded-xl bg-[#0A0A0B] border border-[#262626] text-xs text-[#9CA3AF]"
                  >
                    <div className="w-5 h-5 rounded-md bg-[#C084FC]/10 border border-[#C084FC]/20 flex items-center justify-center text-[#C084FC] shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span>{amenity}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Host / Dorm Owner Card */}
            <div className="p-4 rounded-2xl bg-[#0A0A0B] border border-[#262626] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#C084FC]/10 border border-[#C084FC]/30 flex items-center justify-center text-[#C084FC] font-serif font-bold text-base shrink-0">
                  {room.ownerName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-serif font-semibold text-sm text-white">{room.ownerName}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      Verified Host
                    </span>
                  </div>
                  <p className="text-xs text-[#6B7280]">{room.propertyName}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <a
                  href={`tel:${room.ownerPhone}`}
                  className="flex-1 sm:flex-none p-2.5 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors border border-[#262626]"
                >
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Call Host</span>
                </a>
                <a
                  href={`mailto:${room.ownerEmail}`}
                  className="flex-1 sm:flex-none p-2.5 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors border border-[#262626]"
                >
                  <Mail className="w-3.5 h-3.5 text-[#C084FC]" />
                  <span>Email</span>
                </a>
              </div>
            </div>

            {/* Reservation / Inquiry Form */}
            {showInquiryForm && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={handleBookingSubmit}
                className="p-5 rounded-2xl bg-[#0A0A0B] border border-[#C084FC]/40 space-y-4 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-serif text-sm text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#C084FC]" />
                    Reserve / Inquire for Room #{room.roomNumber}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowInquiryForm(false)}
                    className="text-xs text-[#6B7280] hover:text-white"
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#6B7280] mb-1">Target Move-in Date *</label>
                    <input
                      type="date"
                      required
                      value={moveInDate}
                      onChange={(e) => setMoveInDate(e.target.value)}
                      className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B7280] mb-1">Contact Phone Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+63 900 000 0000"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#6B7280] mb-1">Message to Host (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Ask about curfew, study rules, or parking slot..."
                    value={inquiryMsg}
                    onChange={(e) => setInquiryMsg(e.target.value)}
                    className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl p-3 text-xs text-white outline-none focus:border-[#C084FC]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending Request...' : 'Confirm Reservation Request'}
                </button>
              </motion.form>
            )}
          </div>

          {/* Fixed Footer Actions */}
          <div className="p-4 px-6 bg-[#141416] border-t border-[#262626] flex items-center justify-between gap-3 shrink-0">
            <div>
              <span className="text-[11px] text-[#6B7280]">Total Move-In (1st Mo + Deposit)</span>
              <p className="text-sm font-serif font-bold text-white">
                ₱{(room.priceMonthly + room.depositAmount).toLocaleString()}.00
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!showInquiryForm && (
                <button
                  onClick={() => setShowInquiryForm(true)}
                  disabled={!isAvailable}
                  className={`py-2.5 px-6 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg ${
                    isAvailable
                      ? 'bg-[#C084FC] hover:bg-[#d8b4fe] text-black shadow-[#C084FC]/20'
                      : 'bg-[#1A1A1C] text-[#6B7280] border border-[#262626] cursor-not-allowed'
                  }`}
                >
                  <Home className="w-4 h-4" />
                  <span>{isAvailable ? 'Book or Inquire Room' : 'Fully Occupied'}</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
