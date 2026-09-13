import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Shield, Building2, User, Mail, Lock, CheckCircle2 } from 'lucide-react';
import { UserProfile, UserRole } from '../types';
import { api } from '../lib/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser: (user: UserProfile) => void;
  onShowToast: (title: string, desc?: string, type?: 'success' | 'info') => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSelectUser,
  onShowToast
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [selectedRole, setSelectedRole] = useState<UserRole>('tenant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      onShowToast('Email required', 'Please enter your email address', 'info');
      return;
    }

    try {
      const user = authMode === 'login'
        ? await api.login(email, password)
        : await api.register({ name: name || email.split('@')[0] || 'User', email, password, role: selectedRole });
      onSelectUser(user); onClose();
      onShowToast(authMode === 'login' ? `Signed in as ${user.name}` : 'Welcome to BoardEase', `Active role: ${user.role.toUpperCase()}`, 'success');
    } catch (error) { onShowToast('Authentication failed', error instanceof Error ? error.message : 'Please try again.', 'info'); }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-md bg-[#141416] border border-[#262626] rounded-3xl p-6 sm:p-7 shadow-2xl text-[#F3F4F6] overflow-hidden"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 text-[#6B7280] hover:text-white rounded-lg hover:bg-[#1A1A1C] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Title */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-[#C084FC] flex items-center justify-center text-black font-serif font-bold text-lg shadow-lg shadow-[#C084FC]/20">
              R
            </div>
            <div>
              <h3 className="font-serif font-bold text-xl text-white">Residenz Portal</h3>
              <p className="text-xs text-[#6B7280]">Boarding House & Dormitory System</p>
            </div>
          </div>

          {/* Role Selector Tabs */}
          <div className="mb-4">
            <label className="block text-xs text-[#6B7280] mb-1.5">Select Your Portal Role</label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#0A0A0B] rounded-xl border border-[#262626]">
              <button
                type="button"
                onClick={() => setSelectedRole('admin')}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  selectedRole === 'admin' ? 'bg-[#C084FC] text-black font-bold shadow-md' : 'text-[#6B7280] hover:text-white'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('owner')}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  selectedRole === 'owner' ? 'bg-[#C084FC] text-black font-bold shadow-md' : 'text-[#6B7280] hover:text-white'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Owner</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('tenant')}
                className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  selectedRole === 'tenant' ? 'bg-[#C084FC] text-black font-bold shadow-md' : 'text-[#6B7280] hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Tenant</span>
              </button>
            </div>
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#6B7280] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maria Clara"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#6B7280] absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#6B7280] mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6B7280] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#1A1A1C] border border-[#262626] rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-[#C084FC]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20 mt-4"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{authMode === 'login' ? `Sign In to ${selectedRole.toUpperCase()} Dashboard` : 'Create Account'}</span>
            </button>
          </form>

          {/* Toggle Login / Register */}
          <div className="mt-4 pt-4 border-t border-[#262626] text-center">
            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-xs text-[#6B7280] hover:text-[#C084FC] transition-colors"
            >
              {authMode === 'login'
                ? "Don't have an account? Create one"
                : 'Already registered? Sign in'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
