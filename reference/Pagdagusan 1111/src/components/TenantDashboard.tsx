import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Home, CreditCard, Wrench, Bell, MessageSquare, Plus, 
  CheckCircle2, Clock, AlertTriangle, ShieldCheck, Wifi, 
  Send, Receipt, Upload, Calendar, DollarSign, Share2, Sparkles, Check 
} from 'lucide-react';
import { 
  RoomListing, UserProfile, TenantLease, PaymentRecord, 
  MaintenanceRequest, Announcement, ChatMessage, PaymentMethod, MaintenanceCategory, MaintenancePriority 
} from '../types';
import { api } from '../lib/api';
import confetti from 'canvas-confetti';

interface TenantDashboardProps {
  currentUser: UserProfile;
  rooms: RoomListing[];
  leases: TenantLease[];
  payments: PaymentRecord[];
  maintenance: MaintenanceRequest[];
  announcements: Announcement[];
  messages: ChatMessage[];
  onViewReceipt: (payment: PaymentRecord) => void;
  onOpenShareReceipt: (payment: PaymentRecord) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning') => void;
}

export const TenantDashboard: React.FC<TenantDashboardProps> = ({
  currentUser,
  rooms,
  leases,
  payments,
  maintenance,
  announcements,
  messages,
  onViewReceipt,
  onOpenShareReceipt,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'my-room' | 'payments' | 'maintenance' | 'announcements' | 'chat'>('my-room');
  
  // Pay rent modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('6500');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('GCash');
  const [payRefNo, setPayRefNo] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  // Maintenance ticket modal state
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketCategory, setTicketCategory] = useState<MaintenanceCategory>('Plumbing');
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketPriority, setTicketPriority] = useState<MaintenancePriority>('medium');
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  // Chat with owner state
  const [chatMessage, setChatMessage] = useState('');

  // Tenant-specific data
  const myLease = leases.find(l => l.tenantId === currentUser.id) || leases[0];
  const myRoom = rooms.find(r => r.roomNumber === myLease?.roomNumber || r.roomNumber === '101') || rooms[0];
  const myPayments = payments.filter(p => p.tenantId === currentUser.id || p.roomNumber === myLease?.roomNumber);
  const myMaintenance = maintenance.filter(m => m.tenantId === currentUser.id || m.roomNumber === myLease?.roomNumber);

  const handlePayRentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payRefNo) {
      onShowToast('Reference required', 'Please provide your transaction reference number', 'info');
      return;
    }

    setIsPaying(true);
    try {
      const newPayment: PaymentRecord = {
        id: `pay-${Date.now()}`,
        invoiceNo: `INV-2025-${Math.floor(100 + Math.random() * 900)}`,
        tenantId: currentUser.id,
        tenantName: currentUser.name,
        roomNumber: myLease?.roomNumber || '101',
        propertyName: myLease?.propertyName || 'BoardEase Prime Residences',
        amount: Number(payAmount),
        monthCovered: 'September 2025 Rental',
        dueDate: '2025-09-15',
        paidDate: new Date().toISOString().split('T')[0],
        paymentMethod: payMethod,
        referenceNumber: payRefNo,
        status: 'pending',
        notes: payNotes || `Settled via ${payMethod}`,
        createdAt: new Date().toISOString().split('T')[0]
      };

      await api.addPayment(newPayment);
      setIsPaying(false);
      setShowPayModal(false);
      setPayRefNo('');
      setPayNotes('');
      confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
      onShowToast(
        'Rent Payment Submitted!',
        `Invoice ${newPayment.invoiceNo} processed via ${payMethod}.`,
        'success'
      );
    } catch { setIsPaying(false); onShowToast('Payment failed', 'The server could not save your payment.', 'warning'); }
  };

  const handleCreateTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTitle || !ticketDescription) return;

    setIsSubmittingTicket(true);
    try {
      const newTicket: MaintenanceRequest = {
        id: `maint-${Date.now()}`,
        ticketNo: `MNT-${myLease?.roomNumber || '101'}-${Math.floor(10 + Math.random() * 90)}`,
        tenantId: currentUser.id,
        tenantName: currentUser.name,
        tenantPhone: currentUser.phone || '+63 939 123 4567',
        roomId: myRoom?.id || 'room-101',
        roomNumber: myLease?.roomNumber || '101',
        propertyName: myLease?.propertyName || 'BoardEase Prime Residences',
        category: ticketCategory,
        title: ticketTitle,
        description: ticketDescription,
        priority: ticketPriority,
        status: 'pending',
        photos: [],
        submittedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        updatedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        assignedStaff: 'Kuya Ben (Building Caretaker)'
      };

      await api.addMaintenanceRequest(newTicket);
      setIsSubmittingTicket(false);
      setShowTicketModal(false);
      setTicketTitle('');
      setTicketDescription('');
      onShowToast('Maintenance Ticket Logged', `Ticket #${newTicket.ticketNo} dispatched to building management.`, 'success');
    } catch { setIsSubmittingTicket(false); onShowToast('Ticket failed', 'The server could not save this request.', 'warning'); }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: 'tenant',
      senderAvatar: currentUser.avatar,
      recipientId: 'user-owner-1',
      recipientName: 'Carlos Mendoza (Owner)',
      content: chatMessage.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: true
    };

    try { await api.sendMessage(newMsg); } catch { onShowToast('Message failed', 'The server could not send this message.', 'warning'); return; }
    setChatMessage('');
  };

  const myChatMessages = messages.filter(
    m => (m.senderId === currentUser.id && m.recipientId === 'user-owner-1') ||
         (m.senderId === 'user-owner-1' && m.recipientId === currentUser.id)
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 text-[#F3F4F6]">
      {/* Top Banner Card */}
      <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-[#C084FC]/40"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-serif font-bold text-white">{currentUser.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#C084FC]/10 text-[#C084FC] border border-[#C084FC]/30">
                Verified Resident
              </span>
            </div>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Assigned: <strong className="text-[#C084FC]">Room #{myLease?.roomNumber || '101'}</strong> • {myLease?.propertyName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPayModal(true)}
            className="px-4 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20"
          >
            <CreditCard className="w-4 h-4" />
            <span>Pay Monthly Rent</span>
          </button>
          <button
            onClick={() => setShowTicketModal(true)}
            className="px-4 py-2.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white border border-[#262626] text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <Wrench className="w-4 h-4 text-[#C084FC]" />
            <span>Request Repair</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#262626] gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('my-room')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'my-room' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>My Room & Lease</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'payments' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Rent History & Receipts ({myPayments.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('maintenance')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'maintenance' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <Wrench className="w-4 h-4" />
          <span>Maintenance Status ({myMaintenance.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('announcements')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'announcements' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>House Notices ({announcements.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'chat' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Host Messenger</span>
        </button>
      </div>

      {/* TAB: MY ROOM */}
      {activeTab === 'my-room' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Room Photo & Info */}
          <div className="lg:col-span-8 space-y-6">
            <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-[#C084FC] uppercase tracking-wider">Assigned Accommodation</span>
                  <h2 className="text-xl font-serif font-bold text-white">{myRoom.title}</h2>
                  <p className="text-xs text-[#6B7280]">{myRoom.address}, {myRoom.city}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[#6B7280]">Monthly Rent</span>
                  <div className="text-2xl font-serif font-bold text-[#C084FC]">₱{myRoom.priceMonthly.toLocaleString()}</div>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden aspect-video bg-[#0A0A0B] border border-[#262626]">
                <img src={myRoom.photos[0]} alt={myRoom.title} className="w-full h-full object-cover" />
              </div>

              {/* Amenities included */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Unit Inclusions</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {myRoom.amenities.map((a, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#0A0A0B] border border-[#262626] text-xs text-[#9CA3AF] flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />
                      <span className="truncate">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Lease & Utility Credentials Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            {/* Rent Due Countdown Card */}
            <div className="p-6 rounded-3xl bg-[#141416] border border-[#C084FC]/30 space-y-4 shadow-xl shadow-[#C084FC]/5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#C084FC] uppercase tracking-wider">Next Cutoff</span>
                <Clock className="w-4 h-4 text-[#C084FC]" />
              </div>
              <div>
                <p className="text-2xl font-serif font-bold text-white">September 15, 2025</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Due in 15 days • Monthly Rent: ₱{myRoom.priceMonthly.toLocaleString()}</p>
              </div>
              <button
                onClick={() => setShowPayModal(true)}
                className="w-full py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-[#C084FC]/20"
              >
                Settle Rent Now
              </button>
            </div>

            {/* WiFi & Building Info */}
            <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] space-y-3">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Wifi className="w-4 h-4 text-[#C084FC]" />
                <span>Resident WiFi Passcode</span>
              </h3>
              <div className="p-3 rounded-2xl bg-[#0A0A0B] border border-[#262626] flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-[#6B7280]">SSID: Residenz_Prime_5G</p>
                  <p className="font-mono text-xs font-bold text-emerald-400">PrimeResident#2025</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText('PrimeResident#2025');
                    onShowToast('WiFi Password Copied!', '', 'success');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#1A1A1C] text-white text-xs hover:bg-[#262626] border border-[#262626]"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: PAYMENTS & RECEIPTS */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-base text-white">Payment Records & Official Receipts</h2>
              <p className="text-xs text-[#6B7280]">Track verification status, view receipts, and share with sponsors</p>
            </div>
            <button
              onClick={() => setShowPayModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-[#C084FC]/20"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Submit Payment</span>
            </button>
          </div>

          <div className="space-y-3">
            {myPayments.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-2xl bg-[#141416] border border-[#262626] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">{p.monthCovered}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      p.status === 'paid'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#6B7280]">
                    <span>Invoice: <strong className="text-white font-mono">{p.invoiceNo}</strong></span>
                    <span>Channel: <strong className="text-[#C084FC]">{p.paymentMethod}</strong></span>
                    {p.paidDate && <span>Date: {p.paidDate}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <div className="text-right mr-2">
                    <span className="text-[10px] text-[#6B7280]">Amount</span>
                    <p className="text-base font-serif font-bold text-[#C084FC]">₱{p.amount.toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => onViewReceipt(p)}
                    className="p-2 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white text-xs font-medium border border-[#262626] flex items-center gap-1.5 transition-colors"
                  >
                    <Receipt className="w-3.5 h-3.5 text-[#C084FC]" />
                    <span>View Receipt</span>
                  </button>
                  <button
                    onClick={() => onOpenShareReceipt(p)}
                    className="p-2 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-[#9CA3AF] hover:text-white border border-[#262626]"
                    title="Share Receipt"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: MAINTENANCE TICKETS */}
      {activeTab === 'maintenance' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-base text-white">Maintenance & Repair Requests</h2>
              <p className="text-xs text-[#6B7280]">Real-time tracking of plumbing, electrical, and facility repairs</p>
            </div>
            <button
              onClick={() => setShowTicketModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-[#C084FC]/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>File New Ticket</span>
            </button>
          </div>

          <div className="space-y-3">
            {myMaintenance.map((req) => (
              <div
                key={req.id}
                className="p-5 rounded-2xl bg-[#141416] border border-[#262626] space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[#0A0A0B] border border-[#262626] text-[#C084FC]">
                        {req.category}
                      </span>
                      <span className="font-mono text-xs text-[#6B7280]">{req.ticketNo}</span>
                      <span className="text-xs text-[#6B7280]">• {req.submittedAt}</span>
                    </div>
                    <h3 className="font-semibold text-sm text-white mt-1">{req.title}</h3>
                    <p className="text-xs text-[#9CA3AF] mt-1">{req.description}</p>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                    req.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : req.status === 'in_progress'
                      ? 'bg-[#C084FC]/10 text-[#C084FC] border border-[#C084FC]/30'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}>
                    {req.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Progress Visualizer bar */}
                <div className="pt-2">
                  <div className="flex items-center justify-between text-[10px] text-[#6B7280] mb-1">
                    <span>1. Pending</span>
                    <span>2. Reviewing</span>
                    <span>3. In Progress</span>
                    <span>4. Resolved</span>
                  </div>
                  <div className="h-1.5 bg-[#0A0A0B] rounded-full overflow-hidden flex border border-[#262626]">
                    <div className={`h-full bg-[#C084FC] transition-all ${
                      req.status === 'pending'
                        ? 'w-1/4'
                        : req.status === 'reviewing'
                        ? 'w-2/4'
                        : req.status === 'in_progress'
                        ? 'w-3/4'
                        : 'w-full bg-emerald-500'
                    }`} />
                  </div>
                </div>

                {req.assignedStaff && (
                  <p className="text-[11px] text-[#6B7280] pt-1 border-t border-[#262626]">
                    Assigned Caretaker: <strong className="text-white">{req.assignedStaff}</strong>
                  </p>
                )}
                {req.resolutionNotes && (
                  <p className="text-[11px] text-emerald-400 italic">
                    Resolution: {req.resolutionNotes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: NOTICES */}
      {activeTab === 'announcements' && (
        <div className="space-y-4">
          <h2 className="font-serif text-base text-white">Boarding House Bulletins & Notices</h2>
          <div className="space-y-3">
            {announcements.map((ann) => (
              <div
                key={ann.id}
                className="p-5 rounded-2xl bg-[#141416] border border-[#262626] space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#C084FC] uppercase tracking-wider text-[11px]">
                    {ann.type.replace('_', ' ')}
                  </span>
                  <span className="text-[#6B7280]">{ann.createdAt}</span>
                </div>
                <h3 className="font-serif font-bold text-sm text-white">{ann.title}</h3>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">{ann.content}</p>
                <div className="flex items-center justify-between pt-2 border-t border-[#262626] text-xs text-[#6B7280]">
                  <span>Author: {ann.authorName}</span>
                  <button
                    onClick={() => api.toggleLikeAnnouncement(ann.id).catch(() => onShowToast('Like failed', 'The server could not save your reaction.', 'warning'))}
                    className="flex items-center gap-1 text-[#9CA3AF] hover:text-[#C084FC] transition-colors"
                  >
                    <span>❤️ {ann.likesCount || 0} Likes</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: MESSENGER */}
      {activeTab === 'chat' && (
        <div className="h-[520px] rounded-3xl bg-[#141416] border border-[#262626] flex flex-col justify-between p-4">
          <div className="p-3 border-b border-[#262626] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#C084FC] flex items-center justify-center font-bold text-xs text-black">
                CM
              </div>
              <div>
                <h3 className="font-semibold text-xs text-white">Carlos Mendoza (Dorm Host)</h3>
                <p className="text-[10px] text-emerald-400">Online • Typically replies within 10 mins</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 overflow-y-auto flex-1 p-3">
            {myChatMessages.map((msg) => {
              const isMe = msg.senderId === currentUser.id;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-md p-3.5 rounded-2xl text-xs leading-relaxed ${
                      isMe
                        ? 'bg-[#C084FC] text-black font-medium rounded-br-none shadow-md'
                        : 'bg-[#1A1A1C] text-[#F3F4F6] rounded-bl-none border border-[#262626]'
                    }`}
                  >
                    <p>{msg.content}</p>
                  </div>
                  <span className="text-[10px] text-[#6B7280] mt-1 px-1">{msg.timestamp}</span>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleSendChat} className="pt-3 border-t border-[#262626] flex gap-2">
            <input
              type="text"
              placeholder="Ask owner about dues, guest permissions, or repairs..."
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              className="flex-1 bg-[#1A1A1C] border border-[#262626] rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-[#C084FC]"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-[#C084FC]/20"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </div>
      )}

      {/* Pay Rent Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
          <motion.form
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onSubmit={handlePayRentSubmit}
            className="w-full max-w-md bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl space-y-4 text-[#F3F4F6]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-base text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[#C084FC]" />
                Pay Monthly Rent
              </h3>
              <button
                type="button"
                onClick={() => setShowPayModal(false)}
                className="text-[#6B7280] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Select Payment Gateway</label>
              <div className="grid grid-cols-3 gap-2">
                {(['GCash', 'Maya', 'Bank Transfer'] as PaymentMethod[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPayMethod(method)}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                      payMethod === method
                        ? 'bg-[#1A1A1C] border-[#C084FC] text-[#C084FC]'
                        : 'bg-[#0A0A0B] border-[#262626] text-[#6B7280] hover:text-white'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Amount Due (₱)</label>
              <input
                type="number"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC] font-bold font-serif"
              />
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">{payMethod} Reference No. *</label>
              <input
                type="text"
                required
                placeholder="e.g. 9831448201"
                value={payRefNo}
                onChange={(e) => setPayRefNo(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC] font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Notes / Submeter Breakdown (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Rent + ₱350 electric bill"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPayModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-[#9CA3AF] text-xs font-semibold border border-[#262626]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPaying}
                className="flex-1 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#C084FC]/20 disabled:opacity-50"
              >
                {isPaying ? 'Verifying...' : 'Submit Payment'}
              </button>
            </div>
          </motion.form>
        </div>
      )}

      {/* File Maintenance Ticket Modal */}
      {showTicketModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
          <motion.form
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onSubmit={handleCreateTicketSubmit}
            className="w-full max-w-md bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl space-y-4 text-[#F3F4F6]"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-base text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-[#C084FC]" />
                Submit Maintenance Request
              </h3>
              <button
                type="button"
                onClick={() => setShowTicketModal(false)}
                className="text-[#6B7280] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Issue Category</label>
                <select
                  value={ticketCategory}
                  onChange={(e) => setTicketCategory(e.target.value as any)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="Plumbing">Plumbing</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Aircon / HVAC">Aircon / HVAC</option>
                  <option value="Carpentry / Lock">Carpentry / Lock</option>
                  <option value="Appliance">Appliance</option>
                  <option value="WiFi / Internet">WiFi / Internet</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Urgency</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value as any)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="low">Low (Routine)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent (Emergency)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Subject / Issue Summary *</label>
              <input
                type="text"
                required
                placeholder="e.g. Bathroom sink water faucet leaking"
                value={ticketTitle}
                onChange={(e) => setTicketTitle(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Detailed Description *</label>
              <textarea
                rows={3}
                required
                placeholder="Specify symptoms, when it started, and preferred inspection time..."
                value={ticketDescription}
                onChange={(e) => setTicketDescription(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl p-3 text-xs text-white outline-none focus:border-[#C084FC]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTicketModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-[#9CA3AF] text-xs font-semibold border border-[#262626]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingTicket}
                className="flex-1 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#C084FC]/20 disabled:opacity-50"
              >
                {isSubmittingTicket ? 'Filing...' : 'Submit Request'}
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </div>
  );
};
