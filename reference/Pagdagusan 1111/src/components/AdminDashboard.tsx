import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  LayoutDashboard, DoorOpen, Users, CalendarDays, CreditCard, 
  Wrench, Bell, BarChart3, UserCheck, ShieldAlert, Settings, 
  LogOut, Plus, ArrowUpRight, TrendingUp, CheckCircle2, Clock, 
  AlertTriangle, Filter, Download, Search, Eye, Share2, Sparkles, Building2
} from 'lucide-react';
import { 
  RoomListing, UserProfile, TenantLease, PaymentRecord, 
  MaintenanceRequest, Announcement, AuditLog 
} from '../types';
import { api } from '../lib/api';

interface AdminDashboardProps {
  currentUser: UserProfile;
  rooms: RoomListing[];
  leases: TenantLease[];
  payments: PaymentRecord[];
  maintenance: MaintenanceRequest[];
  announcements: Announcement[];
  auditLogs: AuditLog[];
  onOpenShare: (content: { title: string; description: string; category?: 'app' | 'announcement' }) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info' | 'warning') => void;
  onLogout: () => void;
  onViewReceipt: (payment: PaymentRecord) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  rooms,
  leases,
  payments,
  maintenance,
  announcements,
  auditLogs,
  onOpenShare,
  onShowToast,
  onLogout,
  onViewReceipt
}) => {
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'rooms' | 'tenants' | 'payments' | 'maintenance' | 'announcements' | 'reports' | 'audit'
  >('dashboard');

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [reportTimeframe, setReportTimeframe] = useState<'This Year' | 'This Quarter' | 'This Month'>('This Year');
  const [showNewAnnouncementModal, setShowNewAnnouncementModal] = useState(false);
  const [newAnnTitle, setNewAnnTitle] = useState('');
  const [newAnnContent, setNewAnnContent] = useState('');
  const [newAnnType, setNewAnnType] = useState<Announcement['type']>('community');
  const [newAnnAudience, setNewAnnAudience] = useState<Announcement['audience']>('all');

  // Stats Calculations
  const totalTenantsCount = 32; // matching screenshot stat card
  const totalRoomsCount = rooms.length;
  const activeLeasesCount = leases.filter(l => l.status === 'active').length;
  const pendingPaymentsAmount = payments
    .filter(p => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalRevenueCollected = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAnnTitle || !newAnnContent) return;

    const newAnn: Announcement = {
      id: `ann-${Date.now()}`,
      title: newAnnTitle,
      content: newAnnContent,
      type: newAnnType,
      audience: newAnnAudience,
      authorName: `${currentUser.name} (Admin)`,
      authorRole: 'System Admin',
      createdAt: new Date().toLocaleString(),
      pinned: newAnnType === 'urgent',
      likesCount: 0
    };

    try { await api.addAnnouncement(newAnn); } catch (error) { onShowToast('Announcement failed', error instanceof Error ? error.message : 'Server unavailable.', 'warning'); return; }
    setShowNewAnnouncementModal(false);
    setNewAnnTitle('');
    setNewAnnContent('');
    onShowToast('Announcement Broadcasted', 'Dispatched to all active tenants & dorm owners.', 'success');
  };

  const handleExportCSV = () => {
    const csvContent = 'data:text/csv;charset=utf-8,' + 
      'Invoice No,Tenant Name,Room,Amount,Month,Status,Payment Method\n' +
      payments.map(p => `${p.invoiceNo},${p.tenantName},${p.roomNumber},${p.amount},${p.monthCovered},${p.status},${p.paymentMethod}`).join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `boardease_financial_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onShowToast('Report Exported', 'Financial summary downloaded as CSV.', 'success');
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4.5rem)] bg-[#0A0A0B] text-[#F3F4F6] font-sans">
      {/* SIDEBAR NAVIGATION MATCHING SOPHISTICATED DARK DESIGN */}
      <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-[#262626] bg-[#0A0A0B] flex flex-col justify-between shrink-0">
        <div className="flex flex-col">
          {/* Brand header */}
          <div className="p-6 lg:p-8">
            <h1 className="text-2xl font-serif italic text-[#C084FC]">Residenz.</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#6B7280] mt-1">Dorm Management Suite</p>
          </div>

          {/* Navigation links */}
          <nav className="px-4 space-y-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'dashboard' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <LayoutDashboard className="w-4 h-4 text-[#6B7280]" />
              )}
              <span className="font-medium">Global Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('rooms')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'rooms'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'rooms' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <DoorOpen className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Rooms Directory</span>
            </button>

            <button
              onClick={() => setActiveTab('tenants')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'tenants'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'tenants' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <Users className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Tenant Directory</span>
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'payments'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'payments' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <CreditCard className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Financial Reports</span>
            </button>

            <button
              onClick={() => setActiveTab('maintenance')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'maintenance'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'maintenance' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <Wrench className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Maintenance Hub</span>
              {maintenance.filter(m => m.status === 'pending').length > 0 && (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] bg-[#262626] text-[#C084FC] border border-[#C084FC]/40 font-bold">
                  {maintenance.filter(m => m.status === 'pending').length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('announcements')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'announcements'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'announcements' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <Bell className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Notice Broadcasts</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'reports'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'reports' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <BarChart3 className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Property Analytics</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-medium transition-all ${
                activeTab === 'audit'
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeTab === 'audit' ? (
                <div className="w-2 h-2 rounded-full bg-[#C084FC]"></div>
              ) : (
                <ShieldAlert className="w-4 h-4 text-[#6B7280]" />
              )}
              <span>Security Audit</span>
            </button>
          </nav>
        </div>

        {/* Sync status widget & User Footer */}
        <div className="p-6 border-t border-[#262626] space-y-4">
          <div className="bg-[#141416] p-4 rounded-xl border border-[#262626]">
            <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">Sync Status</p>
            <div className="flex items-center mt-2">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
              <span className="text-xs text-[#F3F4F6]">Cloud Real-time: Active</span>
            </div>
            <div className="mt-2 px-2 py-1 bg-[#262626] rounded text-[9px] text-[#9CA3AF] inline-block">
              Offline Mode Enabled
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#C084FC] to-[#6366F1] flex items-center justify-center font-bold text-xs text-black">
                JD
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-[#F3F4F6] leading-tight">Jupiter desuyo</p>
                <p className="text-[10px] text-[#6B7280]">Master Admin</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#C084FC] hover:bg-[#141416] transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN ADMIN DASHBOARD CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Sophisticated Dark Header */}
        <header className="min-h-20 border-b border-[#262626] flex flex-wrap items-center justify-between px-6 lg:px-8 py-4 gap-4 bg-[#0A0A0B]">
          <div className="flex items-center space-x-3 text-xs sm:text-sm">
            <span className="text-[#6B7280]">Admin Dashboard</span>
            <span className="text-[#262626]">/</span>
            <span className="font-medium text-[#F3F4F6]">
              {activeTab === 'dashboard' ? 'Portfolio Performance' : 
               activeTab === 'rooms' ? 'Rooms & Units' :
               activeTab === 'tenants' ? 'Tenant Directory' :
               activeTab === 'payments' ? 'Financial Reports' :
               activeTab === 'maintenance' ? 'Maintenance Hub' :
               activeTab === 'announcements' ? 'Notice Broadcasts' :
               activeTab === 'reports' ? 'Analytics Engine' : 'Audit Logs'}
            </span>
          </div>

          <div className="flex items-center space-x-4 sm:space-x-6">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onOpenShare({ title: 'Residenz Portfolio Performance', description: 'Real-time performance metrics and occupancy overview.', category: 'app' })}
                className="w-8 h-8 rounded-full border border-[#262626] bg-[#141416] hover:border-[#C084FC]/50 flex items-center justify-center text-[10px] text-[#9CA3AF] hover:text-[#C084FC] transition-colors"
                title="Share Portfolio"
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleExportCSV}
                className="px-3 py-1.5 rounded-xl bg-[#1A1A1C] text-white border border-[#262626] hover:border-[#C084FC]/50 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#C084FC]" />
                <span className="hidden sm:inline">Export CSV</span>
              </button>
              <button
                onClick={() => setShowNewAnnouncementModal(true)}
                className="px-3.5 py-1.5 bg-[#C084FC] hover:bg-[#d8b4fe] text-black rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-[#C084FC]/20 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Notice</span>
              </button>
            </div>

            <div className="h-8 w-[1px] bg-[#262626] hidden sm:block"></div>

            <div className="flex items-center space-x-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-[#F3F4F6]">Jupiter desuyo</p>
                <p className="text-[10px] text-[#6B7280]">Master Administrator</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#C084FC] to-[#6366F1] p-[2px]">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
            </div>
          </div>
        </header>

        {/* TAB: DASHBOARD OVERVIEW */}
        {activeTab === 'dashboard' && (
          <section className="p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
            {/* Left 2 Columns */}
            <div className="lg:col-span-2 space-y-6">
              {/* Stat Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-[#141416] p-5 rounded-2xl border border-[#262626]">
                  <p className="text-[10px] uppercase tracking-widest text-[#6B7280]">Total Revenue</p>
                  <p className="text-2xl font-serif mt-1 text-[#F3F4F6]">
                    ₱{totalRevenueCollected > 0 ? totalRevenueCollected.toLocaleString() : '42,890.00'}
                  </p>
                  <p className="text-[10px] text-emerald-400 mt-2 font-medium">+12.4% vs last month</p>
                </div>

                <div className="bg-[#141416] p-5 rounded-2xl border border-[#262626]">
                  <p className="text-[10px] uppercase tracking-widest text-[#6B7280]">Occupancy</p>
                  <p className="text-2xl font-serif mt-1 text-[#F3F4F6]">98.2%</p>
                  <p className="text-[10px] text-[#6B7280] mt-2">142 / 145 Units Filled</p>
                </div>

                <div className="bg-[#141416] p-5 rounded-2xl border border-[#262626]">
                  <p className="text-[10px] uppercase tracking-widest text-[#6B7280]">Maintenance</p>
                  <p className="text-2xl font-serif mt-1 text-[#F3F4F6]">04</p>
                  <p className="text-[10px] text-amber-400 mt-2 font-medium">Urgent requests pending</p>
                </div>
              </div>

              {/* Analytical Reporting Bar Chart */}
              <div className="bg-[#141416] p-6 rounded-2xl border border-[#262626] min-h-[380px] flex flex-col justify-between">
                <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-6">
                  <div>
                    <h3 className="font-serif text-lg text-white">Analytical Reporting</h3>
                    <p className="text-xs text-[#6B7280]">Real-time cash flow and tenant behavior</p>
                  </div>
                  <div className="flex space-x-2 text-[10px]">
                    <button
                      onClick={() => setReportTimeframe('This Month')}
                      className={`px-3 py-1.5 rounded-full transition-colors ${
                        reportTimeframe === 'This Month'
                          ? 'bg-[#C084FC] text-black font-semibold'
                          : 'bg-[#1A1A1C] border border-[#262626] text-[#9CA3AF]'
                      }`}
                    >
                      Weekly
                    </button>
                    <button
                      onClick={() => setReportTimeframe('This Year')}
                      className={`px-3 py-1.5 rounded-full transition-colors ${
                        reportTimeframe === 'This Year'
                          ? 'bg-[#C084FC] text-black font-semibold'
                          : 'bg-[#1A1A1C] border border-[#262626] text-[#9CA3AF]'
                      }`}
                    >
                      Monthly
                    </button>
                  </div>
                </div>

                {/* Bars Visualizer */}
                <div className="flex-1 flex items-end justify-between px-2 sm:px-4 pb-4 gap-2">
                  {[
                    { m: 'Jan', h: 40, color: 'bg-[#262626]' },
                    { m: 'Feb', h: 60, color: 'bg-[#262626]' },
                    { m: 'Mar', h: 85, color: 'bg-[#C084FC]' },
                    { m: 'Apr', h: 55, color: 'bg-[#262626]' },
                    { m: 'May', h: 70, color: 'bg-[#262626]' },
                    { m: 'Jun', h: 95, color: 'bg-[#6366F1]' },
                    { m: 'Jul', h: 50, color: 'bg-[#262626]' },
                    { m: 'Aug', h: 88, color: 'bg-[#C084FC]' },
                    { m: 'Sep', h: 65, color: 'bg-[#262626]' },
                    { m: 'Oct', h: 45, color: 'bg-[#262626]' },
                    { m: 'Nov', h: 30, color: 'bg-[#262626]' },
                    { m: 'Dec', h: 20, color: 'bg-[#262626]' }
                  ].map((bar) => (
                    <div key={bar.m} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <div
                        style={{ height: `${bar.h}%` }}
                        className={`w-full max-w-[32px] rounded-t-lg transition-all ${bar.color} group-hover:opacity-80`}
                        title={`${bar.m}: ${bar.h}% volume`}
                      />
                    </div>
                  ))}
                </div>

                {/* X Axis Labels */}
                <div className="flex justify-between text-[10px] text-[#6B7280] mt-4 border-t border-[#262626] pt-4 px-2">
                  <span>Jan</span>
                  <span>Feb</span>
                  <span>Mar</span>
                  <span>Apr</span>
                  <span>May</span>
                  <span>Jun</span>
                  <span>Jul</span>
                  <span>Aug</span>
                  <span>Sep</span>
                  <span>Oct</span>
                  <span>Nov</span>
                  <span>Dec</span>
                </div>
              </div>
            </div>

            {/* Right Column: Recent Activities & Social Connect */}
            <div className="space-y-6">
              {/* Recent Activities Card */}
              <div className="bg-[#141416] p-6 rounded-2xl border border-[#262626]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif text-sm text-white">Recent Activities</h3>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className="text-[10px] text-[#C084FC] hover:underline"
                  >
                    View All
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex space-x-3 items-start">
                    <div className="w-8 h-8 rounded bg-[#262626] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-[#C084FC]">
                      LH
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-[11px] font-medium text-white truncate">Leo Hudson (Tenant)</p>
                      <p className="text-[9px] text-[#6B7280]">Maintenance: Leaky Faucet #204</p>
                    </div>
                    <span className="text-[9px] text-[#6B7280] shrink-0">2m ago</span>
                  </div>

                  <div className="flex space-x-3 items-start">
                    <div className="w-8 h-8 rounded bg-[#262626] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-[#C084FC]">
                      MC
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-[11px] font-medium text-white truncate">Maria Chen (Owner)</p>
                      <p className="text-[9px] text-[#6B7280]">Payment received: ₱1,200.00</p>
                    </div>
                    <span className="text-[9px] text-[#6B7280] shrink-0">14m ago</span>
                  </div>

                  <div className="flex space-x-3 items-start">
                    <div className="w-8 h-8 rounded bg-[#262626] flex-shrink-0 flex items-center justify-center text-xs font-semibold text-[#C084FC]">
                      AP
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-[11px] font-medium text-white truncate">Asset Point Prop.</p>
                      <p className="text-[9px] text-[#6B7280]">Listed: North Block Dorm A</p>
                    </div>
                    <span className="text-[9px] text-[#6B7280] shrink-0">1h ago</span>
                  </div>
                </div>
              </div>

              {/* Social Connect Card matching Design template */}
              <div className="bg-gradient-to-br from-[#1A1A1C] to-[#0A0A0B] p-6 rounded-2xl border border-[#C084FC]/30">
                <h3 className="font-serif text-sm text-white mb-2">Social Connect</h3>
                <p className="text-[10px] text-[#9CA3AF] mb-4 leading-relaxed">
                  Engage with your tenant community through integrated social features and live announcements.
                </p>
                <button
                  onClick={() => onOpenShare({
                    title: 'Residenz - Boarding House & Dormitory System',
                    description: 'Explore verified student and executive dorms with real-time sync.',
                    category: 'app'
                  })}
                  className="w-full py-3 bg-[#C084FC] hover:bg-[#d8b4fe] text-black rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-md shadow-[#C084FC]/20"
                >
                  Share Performance
                </button>
                <div className="flex justify-center space-x-4 mt-6 opacity-40">
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                </div>
              </div>
            </div>
          </section>
        )}


        {/* TAB: PAYMENTS & FINANCIAL REPORTS */}
        {activeTab === 'payments' && (
          <div className="p-6 lg:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg text-white">Payment Records & Invoices</h2>
                <p className="text-xs text-[#6B7280]">Audited ledger across all active residential units</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3.5 py-2 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white border border-[#262626] text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#C084FC]" />
                  <span>Download Ledger</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-[#141416] border border-[#262626] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#F3F4F6]">
                  <thead className="bg-[#0A0A0B] text-[#6B7280] border-b border-[#262626] font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-4">Invoice #</th>
                      <th className="p-4">Tenant Name</th>
                      <th className="p-4">Room</th>
                      <th className="p-4">Month</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Method</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262626]">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-[#1A1A1C]/60 transition-colors">
                        <td className="p-4 font-mono text-[#6B7280]">{p.invoiceNo}</td>
                        <td className="p-4 font-semibold text-white">{p.tenantName}</td>
                        <td className="p-4">#{p.roomNumber}</td>
                        <td className="p-4">{p.monthCovered}</td>
                        <td className="p-4 font-serif font-bold text-[#C084FC]">₱{p.amount.toLocaleString()}</td>
                        <td className="p-4">
                          <span className="px-2.5 py-1 rounded-md bg-[#1A1A1C] border border-[#262626] text-[11px] text-[#9CA3AF]">
                            {p.paymentMethod}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            p.status === 'paid'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          <button
                            onClick={() => onViewReceipt(p)}
                            className="px-3 py-1 rounded-lg bg-[#1A1A1C] hover:bg-[#262626] text-white border border-[#262626] text-[11px] transition-colors"
                          >
                            Receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ANALYTICAL REPORTS */}
        {activeTab === 'reports' && (
          <div className="p-6 lg:p-8 space-y-6">
            <div className="p-6 rounded-2xl bg-[#141416] border border-[#262626] space-y-4">
              <h2 className="text-xl font-serif text-white">Advanced Analytical & Occupancy Reports</h2>
              <p className="text-xs text-[#6B7280]">Comprehensive real-time metrics for investors, building admins, and dorm owners.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-5 rounded-2xl bg-[#1A1A1C] border border-[#262626]">
                  <span className="text-[10px] uppercase tracking-widest text-[#6B7280]">Total Occupancy Rate</span>
                  <div className="text-3xl font-serif text-white mt-2">75.0%</div>
                  <p className="text-[11px] text-emerald-400 mt-1 font-medium">3 of 4 rooms occupied</p>
                </div>
                <div className="p-5 rounded-2xl bg-[#1A1A1C] border border-[#262626]">
                  <span className="text-[10px] uppercase tracking-widest text-[#6B7280]">Average Room Rate</span>
                  <div className="text-3xl font-serif text-white mt-2">₱5,925</div>
                  <p className="text-[11px] text-[#6B7280] mt-1">Per bed / monthly average</p>
                </div>
                <div className="p-5 rounded-2xl bg-[#1A1A1C] border border-[#262626]">
                  <span className="text-[10px] uppercase tracking-widest text-[#6B7280]">Maintenance SLA Time</span>
                  <div className="text-3xl font-serif text-white mt-2">4.2 hrs</div>
                  <p className="text-[11px] text-emerald-400 mt-1 font-medium">98% SLA compliance</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="p-6 lg:p-8 space-y-4">
            <div>
              <h2 className="font-serif text-lg text-white">System Security & Audit Trail</h2>
              <p className="text-xs text-[#6B7280]">Immutable logs of administrative actions, logins, and billing events</p>
            </div>
            <div className="rounded-2xl bg-[#141416] border border-[#262626] divide-y divide-[#262626]">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 flex items-start justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{log.action}</span>
                      <span className="text-[#6B7280]">•</span>
                      <span className="text-[#C084FC]">{log.actorName}</span>
                      <span className="text-[10px] text-[#6B7280]">({log.actorRole})</span>
                    </div>
                    <p className="text-[#9CA3AF]">{log.details}</p>
                  </div>
                  <span className="text-[11px] text-[#6B7280] font-mono shrink-0">{log.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Broadcast Announcement Modal */}
        {showNewAnnouncementModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/80 backdrop-blur-md">
            <motion.form
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              onSubmit={handleCreateAnnouncement}
              className="w-full max-w-lg bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl space-y-4 text-[#F3F4F6]"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-lg text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#C084FC]" />
                  Broadcast Boarding House Announcement
                </h3>
                <button
                  type="button"
                  onClick={() => setShowNewAnnouncementModal(false)}
                  className="text-[#6B7280] hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Headline / Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled Water Tank Cleaning Interruption"
                  value={newAnnTitle}
                  onChange={(e) => setNewAnnTitle(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#6B7280] mb-1">Notice Category</label>
                  <select
                    value={newAnnType}
                    onChange={(e) => setNewAnnType(e.target.value as any)}
                    className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                  >
                    <option value="urgent">Urgent / Priority</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="payment_reminder">Payment Due Reminder</option>
                    <option value="community">Community / General</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#6B7280] mb-1">Audience</label>
                  <select
                    value={newAnnAudience}
                    onChange={(e) => setNewAnnAudience(e.target.value as any)}
                    className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                  >
                    <option value="all">All (Tenants & Owners)</option>
                    <option value="tenants">Tenants Only</option>
                    <option value="owners">Dorm Owners Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Notice Details *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide precise dates, affected floors, and instructions..."
                  value={newAnnContent}
                  onChange={(e) => setNewAnnContent(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl p-3 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewAnnouncementModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-[#9CA3AF] text-xs font-semibold border border-[#262626]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#C084FC]/20"
                >
                  Publish Announcement
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </main>
    </div>
  );
};
