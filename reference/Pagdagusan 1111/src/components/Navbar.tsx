import React, { useState } from 'react';
import { 
  Home, Moon, Sun, Database, Share2, LogIn, LogOut, 
  Menu, X, Shield, Building2, User
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';

interface NavbarProps {
  currentUser: UserProfile | null;
  activeView: 'landing' | 'admin' | 'owner' | 'tenant';
  onSelectView: (view: 'landing' | 'admin' | 'owner' | 'tenant') => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onOpenAuth: () => void;
  serverOnline: boolean;
  onOpenShare: () => void;
  onLogout: () => void;
  unreadNotificationsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeView,
  onSelectView,
  isDarkMode,
  onToggleTheme,
  onOpenAuth,
  serverOnline,
  onOpenShare,
  onLogout,
  unreadNotificationsCount = 2
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#262626] bg-[#0A0A0B]/90 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">
        {/* Left Branding Logo with Sophisticated Dark luxury serif styling */}
        <div className="flex items-center gap-8">
          <button
            onClick={() => onSelectView('landing')}
            className="flex items-center gap-3 text-left group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#C084FC] to-[#6366F1] flex items-center justify-center text-black font-bold shadow-lg shadow-[#C084FC]/20 group-hover:scale-105 transition-transform">
              <Home className="w-5 h-5 text-black" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-serif italic text-[#C084FC] tracking-tight leading-none">
                Residenz.
              </h1>
              <p className="text-[10px] uppercase tracking-widest text-[#6B7280] mt-1 font-sans">
                Dorm Management Suite
              </p>
            </div>
          </button>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-1.5">
            <button
              onClick={() => onSelectView('landing')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                activeView === 'landing' 
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]' 
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeView === 'landing' && <div className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />}
              <span>Explore Rooms</span>
            </button>
            <button
              onClick={() => onSelectView('admin')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                activeView === 'admin' 
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]' 
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeView === 'admin' ? (
                <div className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />
              ) : (
                <Shield className="w-3.5 h-3.5 text-[#C084FC]" />
              )}
              <span>Admin Dashboard</span>
            </button>
            <button
              onClick={() => onSelectView('owner')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                activeView === 'owner' 
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]' 
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeView === 'owner' ? (
                <div className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />
              ) : (
                <Building2 className="w-3.5 h-3.5 text-[#9CA3AF]" />
              )}
              <span>Dorm Owner</span>
            </button>
            <button
              onClick={() => onSelectView('tenant')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                activeView === 'tenant' 
                  ? 'bg-[#1A1A1C] text-white border border-[#262626]' 
                  : 'text-[#9CA3AF] hover:text-white hover:bg-[#141416]'
              }`}
            >
              {activeView === 'tenant' ? (
                <div className="w-1.5 h-1.5 rounded-full bg-[#C084FC]" />
              ) : (
                <User className="w-3.5 h-3.5 text-[#9CA3AF]" />
              )}
              <span>Tenant Hub</span>
            </button>
          </nav>
        </div>

        {/* Right Utility & Actions */}
        <div className="flex items-center gap-3">
          {/* API status badge */}
          <button
            onClick={() => undefined}
            className="bg-[#141416] hover:bg-[#1A1A1C] px-3 py-1.5 rounded-xl border border-[#262626] flex items-center gap-2 transition-colors text-left"
            title="PostgreSQL API status"
          >
            <div className={`w-2 h-2 rounded-full ${serverOnline ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`} />
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-[#6B7280]">Sync Status</span>
              <span className="text-[11px] text-[#F3F4F6] font-medium hidden sm:inline">
                {serverOnline ? 'Server: Online' : 'Server: Offline'}
              </span>
            </div>
          </button>

          {/* Social Share Trigger */}
          <button
            onClick={onOpenShare}
            className="p-2.5 rounded-xl text-[#9CA3AF] hover:text-white hover:bg-[#1A1A1C] border border-[#262626] transition-colors"
            title="Social Connect & Share"
          >
            <Share2 className="w-4 h-4 text-[#C084FC]" />
          </button>

          {/* Dark / Light Mode Toggle */}
          <button
            onClick={onToggleTheme}
            className="p-2.5 rounded-xl text-[#9CA3AF] hover:text-white hover:bg-[#1A1A1C] border border-[#262626] transition-colors"
            title={isDarkMode ? 'Dark Mode Active' : 'Light Mode'}
          >
            {isDarkMode ? <Moon className="w-4 h-4 text-[#C084FC]" /> : <Sun className="w-4 h-4 text-amber-400" />}
          </button>

          {/* User Section / Login */}
          {currentUser ? (
            <div className="flex items-center space-x-3 pl-2 border-l border-[#262626]">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-[#F3F4F6]">{currentUser.name}</p>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">
                  {currentUser.role === 'admin' ? 'Master Administrator' : currentUser.role === 'owner' ? 'Property Owner' : 'Resident Tenant'}
                </p>
              </div>
              <div className="relative">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-9 h-9 rounded-full object-cover border border-[#262626]"
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0A0A0B]" />
              </div>
              <button
                onClick={onLogout}
                className="p-2 rounded-lg text-[#6B7280] hover:text-[#C084FC] hover:bg-[#141416] transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="py-2.5 px-4 bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md shadow-[#C084FC]/20 flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Portal Login</span>
            </button>
          )}

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl text-[#9CA3AF] hover:text-white hover:bg-[#1A1A1C] border border-[#262626]"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden p-4 bg-[#0A0A0B] border-b border-[#262626] space-y-2 animate-fadeIn">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => { onSelectView('landing'); setMobileMenuOpen(false); }}
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                activeView === 'landing' ? 'bg-[#1A1A1C] border-[#C084FC] text-white' : 'bg-[#141416] border-[#262626] text-[#9CA3AF]'
              }`}
            >
              <Home className="w-4 h-4 text-[#C084FC]" />
              <span>Explore Rooms</span>
            </button>
            <button
              onClick={() => { onSelectView('admin'); setMobileMenuOpen(false); }}
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                activeView === 'admin' ? 'bg-[#1A1A1C] border-[#C084FC] text-white' : 'bg-[#141416] border-[#262626] text-[#9CA3AF]'
              }`}
            >
              <Shield className="w-4 h-4 text-[#C084FC]" />
              <span>Admin Portal</span>
            </button>
            <button
              onClick={() => { onSelectView('owner'); setMobileMenuOpen(false); }}
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                activeView === 'owner' ? 'bg-[#1A1A1C] border-[#C084FC] text-white' : 'bg-[#141416] border-[#262626] text-[#9CA3AF]'
              }`}
            >
              <Building2 className="w-4 h-4 text-[#C084FC]" />
              <span>Dorm Owner</span>
            </button>
            <button
              onClick={() => { onSelectView('tenant'); setMobileMenuOpen(false); }}
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                activeView === 'tenant' ? 'bg-[#1A1A1C] border-[#C084FC] text-white' : 'bg-[#141416] border-[#262626] text-[#9CA3AF]'
              }`}
            >
              <User className="w-4 h-4 text-[#C084FC]" />
              <span>Tenant Hub</span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#262626]">
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="text-xs text-[#C084FC] font-medium flex items-center gap-1.5"
            >
              <Database className="w-3.5 h-3.5" />
              <span>PostgreSQL API Status</span>
            </button>
            {!currentUser && (
              <button
                onClick={() => { onOpenAuth(); setMobileMenuOpen(false); }}
                className="text-xs text-white bg-[#C084FC] px-3 py-1.5 rounded-lg font-semibold text-black"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

