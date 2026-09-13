import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, DoorOpen, CreditCard, MessageSquare, Plus, 
  CheckCircle2, XCircle, Clock, ShieldCheck, Phone, Mail, 
  Send, Edit3, Trash2, Users, AlertCircle, Eye, Share2, Upload 
} from 'lucide-react';
import { 
  RoomListing, UserProfile, TenantLease, PaymentRecord, 
  MaintenanceRequest, ChatMessage 
} from '../types';
import { api } from '../lib/api';

interface OwnerDashboardProps {
  currentUser: UserProfile;
  rooms: RoomListing[];
  leases: TenantLease[];
  payments: PaymentRecord[];
  maintenance: MaintenanceRequest[];
  messages: ChatMessage[];
  onOpenShare: (room: RoomListing) => void;
  onViewReceipt: (payment: PaymentRecord) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning') => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  currentUser,
  rooms,
  leases,
  payments,
  maintenance,
  messages,
  onOpenShare,
  onViewReceipt,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'rooms' | 'payments' | 'maintenance' | 'chat' | 'tenants'>('rooms');
  const [showAddRoomModal, setShowAddRoomModal] = useState(false);

  // New room state
  const [newTitle, setNewTitle] = useState('');
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newPrice, setNewPrice] = useState('5000');
  const [newDeposit, setNewDeposit] = useState('5000');
  const [newCapacity, setNewCapacity] = useState('2');
  const [newRoomType, setNewRoomType] = useState<RoomListing['roomType']>('Single Deluxe');
  const [newGender, setNewGender] = useState<RoomListing['genderPreference']>('All / Mixed');
  const [newDescription, setNewDescription] = useState('');
  const [newAmenities, setNewAmenities] = useState<string[]>([
    'Inverter Aircon', 'WiFi 6 Internet', 'Private CR'
  ]);

  // Direct chat state
  const [selectedTenantId, setSelectedTenantId] = useState<string>('user-tenant-1');
  const [chatInput, setChatInput] = useState('');

  const ownerRooms = rooms.filter(r => r.ownerId === currentUser.id || true);
  const pendingPayments = payments.filter(p => p.status === 'pending');

  const handleApprovePayment = async (paymentId: string) => {
    try { await api.updatePaymentStatus(paymentId, 'paid', 'Verified and approved by owner');
    onShowToast('Payment Approved', 'Rent invoice marked as PAID. Official receipt issued.', 'success');
    } catch { onShowToast('Payment update failed', 'The server could not save this change.', 'warning'); }
  };

  const handleRejectPayment = async (paymentId: string) => {
    try { await api.updatePaymentStatus(paymentId, 'rejected', 'Payment reference unverified');
    onShowToast('Payment Flagged', 'Returned to tenant for re-submission.', 'warning');
    } catch { onShowToast('Payment update failed', 'The server could not save this change.', 'warning'); }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newRoomNumber) return;

    const newRoom: RoomListing = {
      id: `room-${Date.now()}`,
      title: newTitle,
      roomNumber: newRoomNumber,
      propertyName: currentUser.propertyAssigned || 'BoardEase Prime Residences',
      address: '42 University Belt Avenue, Sampaloc',
      city: 'Manila',
      priceMonthly: Number(newPrice),
      depositAmount: Number(newDeposit),
      capacity: Number(newCapacity),
      occupiedCount: 0,
      status: 'available',
      roomType: newRoomType,
      genderPreference: newGender,
      amenities: newAmenities,
      photos: [
        'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1200&q=80'
      ],
      description: newDescription || 'Comfortable and secure room for students and working professionals.',
      rating: 5.0,
      reviewsCount: 1,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerPhone: currentUser.phone || '+63 928 444 8821',
      ownerEmail: currentUser.email,
      createdAt: new Date().toISOString().split('T')[0]
    };

    try { await api.addRoom(newRoom); } catch { onShowToast('Room creation failed', 'The server could not save this room.', 'warning'); return; }
    setShowAddRoomModal(false);
    onShowToast('Room Created & Published', `Room #${newRoomNumber} is now live on the marketplace.`, 'success');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const targetTenant = leases.find(l => l.tenantId === selectedTenantId);

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: currentUser.id,
      senderName: `${currentUser.name} (Owner)`,
      senderRole: 'owner',
      senderAvatar: currentUser.avatar,
      recipientId: selectedTenantId,
      recipientName: targetTenant?.tenantName || 'Tenant',
      content: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: true
    };

    try { await api.sendMessage(newMsg); } catch { onShowToast('Message failed', 'The server could not send this message.', 'warning'); return; }
    setChatInput('');
  };

  const filteredChat = messages.filter(
    m => (m.senderId === currentUser.id && m.recipientId === selectedTenantId) ||
         (m.senderId === selectedTenantId && m.recipientId === currentUser.id)
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 text-[#F3F4F6]">
      {/* Header Profile & Quick Stats */}
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
                Dorm Host / Owner
              </span>
            </div>
            <p className="text-xs text-[#6B7280] mt-0.5">{currentUser.propertyAssigned || 'Residenz Residences Host'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowAddRoomModal(true)}
            className="px-4 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Room Unit</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#262626] gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('rooms')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'rooms' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <DoorOpen className="w-4 h-4" />
          <span>My Room Listings ({ownerRooms.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'payments' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Rent Verification & Dues</span>
          {pendingPayments.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-black font-bold">
              {pendingPayments.length} Pending
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'chat' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Tenant Communication</span>
        </button>
        <button
          onClick={() => setActiveTab('tenants')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors shrink-0 ${
            activeTab === 'tenants' ? 'bg-[#C084FC] text-black font-bold' : 'text-[#9CA3AF] hover:text-white bg-[#141416] border border-[#262626]'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Leases & Tenants ({leases.length})</span>
        </button>
      </div>

      {/* TAB: ROOMS LISTINGS */}
      {activeTab === 'rooms' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ownerRooms.map((room) => (
              <div
                key={room.id}
                className="rounded-2xl bg-[#141416] border border-[#262626] overflow-hidden flex flex-col justify-between"
              >
                <div className="relative aspect-video bg-[#0A0A0B]">
                  <img src={room.photos[0]} alt={room.title} className="w-full h-full object-cover" />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-[#0A0A0B]/80 text-[11px] font-semibold text-white border border-[#262626]">
                    Room #{room.roomNumber}
                  </div>
                  <div className="absolute top-2 right-2">
                    <button
                      onClick={() => onOpenShare(room)}
                      className="p-1.5 rounded-full bg-[#0A0A0B]/80 text-[#9CA3AF] hover:text-[#C084FC] transition-colors border border-[#262626]"
                      title="Share Room Listing"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-semibold text-sm text-white">{room.title}</h3>
                    <p className="text-xs text-[#9CA3AF] mt-1 line-clamp-2">{room.description}</p>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-[#262626]">
                    <div>
                      <span className="text-[10px] text-[#6B7280]">Monthly Rent</span>
                      <p className="font-serif font-bold text-[#C084FC]">₱{room.priceMonthly.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-[#6B7280]">Occupancy</span>
                      <p className="font-semibold text-white">{room.occupiedCount} / {room.capacity} Slots</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: PAYMENTS APPROVAL */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div>
            <h2 className="font-serif text-base text-white">Tenant Payment Verification Hub</h2>
            <p className="text-xs text-[#6B7280]">Review and verify incoming proof of payments and automated rent ledgers</p>
          </div>
          
          <div className="space-y-3">
            {payments.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-2xl bg-[#141416] border border-[#262626] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">{p.tenantName}</span>
                    <span className="text-xs text-[#6B7280]">(Room #{p.roomNumber})</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      p.status === 'paid'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : p.status === 'pending'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#6B7280]">
                    <span>Invoice: <strong className="text-white font-mono">{p.invoiceNo}</strong></span>
                    <span>Method: <strong className="text-[#C084FC]">{p.paymentMethod}</strong></span>
                    {p.referenceNumber && <span>Ref: <strong className="text-slate-300 font-mono">{p.referenceNumber}</strong></span>}
                  </div>
                  {p.notes && <p className="text-[11px] text-[#9CA3AF] italic mt-0.5">{p.notes}</p>}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <div className="text-right mr-3 hidden sm:block">
                    <span className="text-xs text-[#6B7280]">Amount</span>
                    <p className="text-lg font-serif font-bold text-[#C084FC]">₱{p.amount.toLocaleString()}</p>
                  </div>

                  <button
                    onClick={() => onViewReceipt(p)}
                    className="p-2 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white text-xs font-medium border border-[#262626] flex items-center gap-1.5 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#C084FC]" />
                    <span>View Slip</span>
                  </button>

                  {p.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApprovePayment(p.id)}
                        className="p-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-950"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => handleRejectPayment(p.id)}
                        className="p-2 px-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-600/30 text-xs font-bold uppercase transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: TENANT CHAT */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-[520px] rounded-3xl bg-[#141416] border border-[#262626] overflow-hidden">
          {/* Tenant selector list */}
          <div className="md:col-span-4 border-r border-[#262626] p-3 space-y-2 overflow-y-auto bg-[#0A0A0B]/60">
            <h3 className="text-xs font-semibold text-[#6B7280] px-2 py-1 uppercase tracking-wider">Active Tenants</h3>
            {leases.map((lease) => (
              <button
                key={lease.id}
                onClick={() => setSelectedTenantId(lease.tenantId)}
                className={`w-full p-3 rounded-2xl text-left flex items-center gap-3 transition-colors ${
                  selectedTenantId === lease.tenantId
                    ? 'bg-[#1A1A1C] border border-[#C084FC]/40 text-white'
                    : 'bg-[#141416] hover:bg-[#1A1A1C] text-[#9CA3AF] border border-transparent'
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-[#C084FC] flex items-center justify-center font-bold text-xs text-black shrink-0">
                  {lease.tenantName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-xs text-white truncate">{lease.tenantName}</p>
                  <p className="text-[11px] text-[#6B7280]">Room #{lease.roomNumber}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Chat Window */}
          <div className="md:col-span-8 flex flex-col justify-between p-4 bg-[#141416]">
            {/* Message Feed */}
            <div className="space-y-3 overflow-y-auto flex-1 p-2">
              {filteredChat.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[#6B7280]">
                  No previous messages with this tenant. Start a conversation!
                </div>
              ) : (
                filteredChat.map((msg) => {
                  const isMe = msg.senderId === currentUser.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
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
                })
              )}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="pt-3 border-t border-[#262626] flex gap-2">
              <input
                type="text"
                placeholder="Type a message or maintenance update..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 bg-[#1A1A1C] border border-[#262626] rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-[#C084FC]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md shadow-[#C084FC]/20"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB: TENANTS LEASES */}
      {activeTab === 'tenants' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#141416] border border-[#262626] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#F3F4F6]">
                <thead className="bg-[#0A0A0B] text-[#6B7280] border-b border-[#262626] font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Tenant Name</th>
                    <th className="p-4">Room</th>
                    <th className="p-4">Contact</th>
                    <th className="p-4">Lease Period</th>
                    <th className="p-4">Monthly Rent</th>
                    <th className="p-4">Emergency Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262626]">
                  {leases.map((lease) => (
                    <tr key={lease.id} className="hover:bg-[#1A1A1C]/60 transition-colors">
                      <td className="p-4 font-semibold text-white">{lease.tenantName}</td>
                      <td className="p-4">Room #{lease.roomNumber}</td>
                      <td className="p-4 font-mono text-[#9CA3AF]">{lease.tenantPhone}</td>
                      <td className="p-4">{lease.startDate} to {lease.endDate}</td>
                      <td className="p-4 font-serif font-bold text-[#C084FC]">₱{lease.monthlyRent.toLocaleString()}</td>
                      <td className="p-4 text-[#9CA3AF]">
                        {lease.emergencyContact.name} ({lease.emergencyContact.relationship}) - {lease.emergencyContact.phone}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Room Modal */}
      {showAddRoomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
          <motion.form
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onSubmit={handleAddRoom}
            className="w-full max-w-xl bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl space-y-4 text-[#F3F4F6] max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-base text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#C084FC]" />
                List New Dorm Room Unit
              </h3>
              <button
                type="button"
                onClick={() => setShowAddRoomModal(false)}
                className="text-[#6B7280] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Room Number *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 202"
                  value={newRoomNumber}
                  onChange={(e) => setNewRoomNumber(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC] font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Room Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Executive Single Suite"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Monthly Rent (₱) *</label>
                <input
                  type="number"
                  required
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Deposit (₱) *</label>
                <input
                  type="number"
                  required
                  value={newDeposit}
                  onChange={(e) => setNewDeposit(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Max Capacity *</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  required
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Room Configuration</label>
                <select
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as any)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="Single Deluxe">Single Deluxe</option>
                  <option value="Double Sharing">Double Sharing</option>
                  <option value="Quad Dorm">Quad Student Dorm</option>
                  <option value="Studio">Studio / Loft</option>
                  <option value="Bedspace">Bedspace</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Gender Rule</label>
                <select
                  value={newGender}
                  onChange={(e) => setNewGender(e.target.value as any)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="All / Mixed">All / Mixed</option>
                  <option value="Female Only">Female Only</option>
                  <option value="Male Only">Male Only</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Description</label>
              <textarea
                rows={2}
                placeholder="Details on ventilation, study area, lighting, etc."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl p-3 text-xs text-white outline-none focus:border-[#C084FC]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddRoomModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-[#9CA3AF] text-xs font-semibold border border-[#262626]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#C084FC]/20"
              >
                Publish Room Listing
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </div>
  );
};
