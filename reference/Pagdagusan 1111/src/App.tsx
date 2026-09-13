import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from './lib/api';
import { 
  UserProfile, RoomListing, PaymentRecord, TenantLease, 
  MaintenanceRequest, Announcement, AuditLog, ChatMessage 
} from './types';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { AdminDashboard } from './components/AdminDashboard';
import { OwnerDashboard } from './components/OwnerDashboard';
import { TenantDashboard } from './components/TenantDashboard';
import { RoomDetailModal } from './components/RoomDetailModal';
import { ReceiptModal } from './components/ReceiptModal';
import { SocialShareModal, ShareContent } from './components/SocialShareModal';
import { AuthModal } from './components/AuthModal';
import { Toast, ToastState } from './components/Toast';

export default function App() {
  // Theme state (Dark mode default as requested)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('boardease_theme');
    return saved ? saved === 'dark' : true;
  });

  // Current active user & view
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [activeView, setActiveView] = useState<'landing' | 'admin' | 'owner' | 'tenant'>('landing');

  // Data loaded from the PostgreSQL API
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [leases, setLeases] = useState<TenantLease[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Modals state
  const [selectedRoom, setSelectedRoom] = useState<RoomListing | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<PaymentRecord | null>(null);
  const [shareContent, setShareContent] = useState<ShareContent | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [isServerOnline, setIsServerOnline] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<ToastState>({
    show: false,
    title: '',
    desc: '',
    type: 'info'
  });

  // Sync dark mode class to HTML element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('boardease_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('boardease_theme', 'light');
    }
  }, [isDarkMode]);

  const refreshData = async () => {
    try {
      const [nextRooms, nextLeases, nextPayments, nextMaintenance, nextAnnouncements, nextAuditLogs, nextMessages] = await Promise.all([
        api.getRooms(), api.getLeases(), api.getPayments(), api.getMaintenanceRequests(), api.getAnnouncements(), api.getAuditLogs(), api.getMessages()
      ]);
      setRooms(nextRooms); setLeases(nextLeases); setPayments(nextPayments); setMaintenance(nextMaintenance);
      setAnnouncements(nextAnnouncements); setAuditLogs(nextAuditLogs); setMessages(nextMessages); setIsServerOnline(true);
    } catch { setIsServerOnline(false); }
  };

  useEffect(() => {
    refreshData();
    api.getCurrentUser().then(setCurrentUser).catch(() => undefined);
    const handleChange = () => refreshData();
    window.addEventListener('boardease:data-changed', handleChange);
    return () => window.removeEventListener('boardease:data-changed', handleChange);
  }, []);

  const handleShowToast = (title: string, desc?: string, type: 'success' | 'info' | 'warning' = 'info') => {
    setToast({
      show: true,
      title,
      desc,
      type
    });
  };

  const handleToggleTheme = () => {
    setIsDarkMode(prev => !prev);
  };

  const handleSelectUser = (user: UserProfile) => {
    setCurrentUser(user);
    if (user.role === 'admin') setActiveView('admin');
    else if (user.role === 'owner') setActiveView('owner');
    else if (user.role === 'tenant') setActiveView('tenant');
    else setActiveView('landing');
  };

  const handleLogout = () => {
    api.logout().catch(() => undefined);
    setCurrentUser(null);
    setActiveView('landing');
    handleShowToast('Signed Out', 'You have been logged out safely.', 'info');
  };

  const handleOpenRoomShare = (room: RoomListing) => {
    setShareContent({
      title: `${room.title} - ₱${room.priceMonthly.toLocaleString()}/mo`,
      description: `Check out Room #${room.roomNumber} at ${room.propertyName}, ${room.city}. Inclusions: ${room.amenities.slice(0, 3).join(', ')}.`,
      category: 'room',
      image: room.photos[0]
    });
  };

  const handleOpenReceiptShare = (payment: PaymentRecord) => {
    setShareContent({
      title: `BoardEase Payment Receipt - ${payment.invoiceNo}`,
      description: `Official rental payment confirmation of ₱${payment.amount.toLocaleString()} for ${payment.monthCovered}. Room #${payment.roomNumber}.`,
      category: 'receipt'
    });
  };

  const handleOpenAppShare = () => {
    setShareContent({
      title: 'BoardEase - Modern Boarding House & Dorm Management',
      description: 'Discover comfortable, verified boarding houses with dark mode, online rent receipts, and real-time maintenance requests.',
      category: 'app'
    });
  };

  const handleBookInquiry = (
    room: RoomListing,
    bookingDetails: { date: string; message: string; contact: string }
  ) => {
    const newInquiryMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: currentUser ? currentUser.id : 'guest-inquiry',
      senderName: currentUser ? currentUser.name : `Prospective Tenant (${bookingDetails.contact})`,
      senderRole: 'tenant',
      senderAvatar: currentUser?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80',
      recipientId: room.ownerId,
      recipientName: room.ownerName,
      content: `[Booking Inquiry for Room #${room.roomNumber}] Target Move-in: ${bookingDetails.date}. Message: ${bookingDetails.message}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false
    };

    api.sendMessage(newInquiryMsg).catch(() => handleShowToast('Inquiry failed', 'The server could not save your inquiry.', 'warning'));
    setSelectedRoom(null);
    handleShowToast('Booking Inquiry Dispatched', `Direct notice sent to ${room.ownerName}.`, 'success');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">
      {/* Universal Top Navigation */}
      <Navbar
        currentUser={currentUser}
        activeView={activeView}
        onSelectView={(view) => {
          if ((view === 'admin' || view === 'owner' || view === 'tenant') && !currentUser) {
            setIsAuthOpen(true);
            return;
          }
          setActiveView(view);
        }}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        onOpenAuth={() => setIsAuthOpen(true)}
        serverOnline={isServerOnline}
        onOpenShare={handleOpenAppShare}
        onLogout={handleLogout}
        unreadNotificationsCount={maintenance.filter(m => m.status === 'pending').length}
      />

      {/* Main View Transition Container */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          {activeView === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <LandingPage
                rooms={rooms}
                currentUser={currentUser}
                onSelectRoom={(room) => setSelectedRoom(room)}
                onShareRoom={handleOpenRoomShare}
                onShareApp={handleOpenAppShare}
                onNavigateToAuth={() => setIsAuthOpen(true)}
                onNavigateToPortal={(role) => {
                  if (!currentUser) {
                    setIsAuthOpen(true);
                  } else {
                    setActiveView(role);
                  }
                }}
              />
            </motion.div>
          )}

          {activeView === 'admin' && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <AdminDashboard
                currentUser={currentUser || {
                  id: 'user-admin-1',
                  name: 'Jupiter desuyo',
                  email: 'admin@boardease.ph',
                  role: 'admin',
                  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
                  joinedDate: '2024-01-01',
                  status: 'active'
                }}
                rooms={rooms}
                leases={leases}
                payments={payments}
                maintenance={maintenance}
                announcements={announcements}
                auditLogs={auditLogs}
                onOpenShare={handleOpenAppShare}
                onShowToast={handleShowToast}
                onLogout={handleLogout}
                onViewReceipt={(p) => setSelectedReceiptPayment(p)}
              />
            </motion.div>
          )}

          {activeView === 'owner' && (
            <motion.div
              key="owner"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <OwnerDashboard
                currentUser={currentUser || {
                  id: 'user-owner-1',
                  name: 'Carlos Mendoza',
                  email: 'carlos@boardease.ph',
                  role: 'owner',
                  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
                  propertyAssigned: 'BoardEase Prime Residences',
                  phone: '+63 928 444 8821',
                  joinedDate: '2024-03-10',
                  status: 'active'
                }}
                rooms={rooms}
                leases={leases}
                payments={payments}
                maintenance={maintenance}
                messages={messages}
                onOpenShare={handleOpenRoomShare}
                onViewReceipt={(p) => setSelectedReceiptPayment(p)}
                onShowToast={handleShowToast}
              />
            </motion.div>
          )}

          {activeView === 'tenant' && (
            <motion.div
              key="tenant"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <TenantDashboard
                currentUser={currentUser || {
                  id: 'user-tenant-1',
                  name: 'Aira Santos',
                  email: 'aira@student.edu.ph',
                  role: 'tenant',
                  avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
                  propertyAssigned: 'BoardEase Prime Residences',
                  roomNumber: '101',
                  phone: '+63 917 555 9012',
                  joinedDate: '2024-08-01',
                  status: 'active'
                }}
                rooms={rooms}
                leases={leases}
                payments={payments}
                maintenance={maintenance}
                announcements={announcements}
                messages={messages}
                onViewReceipt={(p) => setSelectedReceiptPayment(p)}
                onOpenShareReceipt={handleOpenReceiptShare}
                onShowToast={handleShowToast}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Global Modals & Drawers */}
      <RoomDetailModal
        isOpen={!!selectedRoom}
        onClose={() => setSelectedRoom(null)}
        room={selectedRoom}
        currentUser={currentUser}
        onShare={handleOpenRoomShare}
        onBookInquiry={handleBookInquiry}
        onShowToast={handleShowToast}
      />

      <ReceiptModal
        isOpen={!!selectedReceiptPayment}
        onClose={() => setSelectedReceiptPayment(null)}
        payment={selectedReceiptPayment}
        onShare={handleOpenReceiptShare}
        onShowToast={handleShowToast}
      />

      <SocialShareModal
        isOpen={!!shareContent}
        onClose={() => setShareContent(null)}
        content={shareContent}
        onShowToast={handleShowToast}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSelectUser={handleSelectUser}
        onShowToast={handleShowToast}
      />

      {/* Global Toast Notification */}
      <Toast
        toast={toast}
        onClose={() => setToast(prev => ({ ...prev, show: false }))}
      />
    </div>
  );
}
