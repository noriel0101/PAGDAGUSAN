import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Search, MapPin, Calendar, Users, DollarSign, Play, 
  Star, ShieldCheck, Wifi, Sparkles, Share2, ArrowRight, 
  Building2, CheckCircle2, SlidersHorizontal, Heart, Phone 
} from 'lucide-react';
import { RoomListing, UserProfile } from '../types';

interface LandingPageProps {
  rooms: RoomListing[];
  currentUser: UserProfile | null;
  onSelectRoom: (room: RoomListing) => void;
  onShareRoom: (room: RoomListing) => void;
  onShareApp: () => void;
  onNavigateToAuth: () => void;
  onNavigateToPortal: (role: 'admin' | 'owner' | 'tenant') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  rooms,
  currentUser,
  onSelectRoom,
  onShareRoom,
  onShareApp,
  onNavigateToAuth,
  onNavigateToPortal
}) => {
  // Search & Filter State
  const [locationSearch, setLocationSearch] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [maxBudget, setMaxBudget] = useState<number>(10000);
  const [filterGender, setFilterGender] = useState('All');
  const [filterAmenity, setFilterAmenity] = useState('All');
  const [likedRooms, setLikedRooms] = useState<Set<string>>(new Set());
  const [showVideoModal, setShowVideoModal] = useState(false);

  const toggleLike = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(likedRooms);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLikedRooms(next);
  };

  // Filtered rooms calculation
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      const matchLoc = !locationSearch || 
        room.city.toLowerCase().includes(locationSearch.toLowerCase()) ||
        room.address.toLowerCase().includes(locationSearch.toLowerCase()) ||
        room.propertyName.toLowerCase().includes(locationSearch.toLowerCase());

      const matchType = selectedType === 'All' || room.roomType.toLowerCase().includes(selectedType.toLowerCase());
      const matchBudget = room.priceMonthly <= maxBudget;
      const matchGender = filterGender === 'All' || room.genderPreference === filterGender || room.genderPreference === 'All / Mixed';
      const matchAmenity = filterAmenity === 'All' || room.amenities.some(a => a.toLowerCase().includes(filterAmenity.toLowerCase()));

      return matchLoc && matchType && matchBudget && matchGender && matchAmenity;
    });
  }, [rooms, locationSearch, selectedType, maxBudget, filterGender, filterAmenity]);

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#F3F4F6] pb-20 font-sans">
      {/* HERO SECTION MATCHING SOPHISTICATED DARK DESIGN */}
      <section className="relative pt-8 sm:pt-14 pb-20 overflow-hidden bg-gradient-to-b from-[#0A0A0B] via-[#141416]/60 to-[#0A0A0B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Copy & Headline */}
            <div className="lg:col-span-7 space-y-6 text-left">
              {/* Tag: YOUR HOME. YOUR COMMUNITY */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1A1A1C] border border-[#262626] text-[#C084FC] text-xs font-bold tracking-wider uppercase"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Curated Living • Modern Residencies</span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold text-white tracking-tight leading-[1.15]"
              >
                Find Your Ideal Boarding Suite.{' '}
                <span className="italic text-[#C084FC]">Residenz.</span>
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-base sm:text-lg text-[#9CA3AF] max-w-xl font-normal leading-relaxed"
              >
                Discover elevated, comfortable, and safe dormitories and boarding houses.
                Live better, study in peace, and thrive with real-time room availability and verified facilities.
              </motion.p>

              {/* Action Buttons */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="flex flex-wrap items-center gap-3 pt-2"
              >
                <a
                  href="#room-listings"
                  className="px-6 py-3.5 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black font-bold uppercase tracking-wider text-xs sm:text-sm flex items-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20 hover:scale-[1.02]"
                >
                  <Building2 className="w-4 h-4" />
                  <span>Browse Rooms</span>
                </a>
                <button
                  onClick={() => setShowVideoModal(true)}
                  className="px-5 py-3.5 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] text-white border border-[#262626] font-medium text-xs sm:text-sm flex items-center gap-2 transition-all"
                >
                  <Play className="w-4 h-4 text-[#C084FC] fill-[#C084FC]" />
                  <span>Watch Video Tour</span>
                </button>
              </motion.div>

              {/* Trust Badges */}
              <div className="flex items-center gap-6 pt-4 text-xs text-[#6B7280]">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>100% Verified Dorms</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Wifi className="w-4 h-4 text-sky-400" />
                  <span>Fiber Internet Ready</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#C084FC]" />
                  <span>Real-Time Inquiries</span>
                </div>
              </div>
            </div>

            {/* Right Hero Image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-5 relative"
            >
              <div className="relative rounded-3xl overflow-hidden border border-[#262626] shadow-2xl bg-[#141416] group">
                <img
                  src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=80"
                  alt="Modern Boarding House Building"
                  className="w-full h-[380px] sm:h-[440px] object-cover group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-transparent to-transparent opacity-80" />
                
                {/* Floating highlight card */}
                <div className="absolute bottom-5 left-5 right-5 p-4 rounded-2xl bg-[#141416]/90 backdrop-blur-md border border-[#262626] flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-[#C084FC] font-bold uppercase tracking-wider">Top Rated Dormitory</span>
                    <p className="font-serif font-bold text-white text-sm">Residenz Prime Residences</p>
                    <p className="text-[#6B7280] text-[11px]">Sampaloc, University Belt Manila</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#6B7280]">Starting from</span>
                    <p className="font-serif font-bold text-base text-[#C084FC]">₱3,200/mo</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* FLOATING SEARCH & FILTER BAR */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-12 p-3 sm:p-4 rounded-3xl bg-[#141416] border border-[#262626] shadow-2xl backdrop-blur-xl"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-center">
              {/* Location Input */}
              <div className="p-2.5 px-3 rounded-2xl bg-[#1A1A1C] border border-[#262626] text-left">
                <label className="block text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <MapPin className="w-3 h-3 text-[#C084FC]" />
                  <span>Location</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter location / city"
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  className="w-full bg-transparent text-xs font-medium text-white placeholder-[#6B7280] outline-none"
                />
              </div>

              {/* Move-In Date */}
              <div className="p-2.5 px-3 rounded-2xl bg-[#1A1A1C] border border-[#262626] text-left">
                <label className="block text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <Calendar className="w-3 h-3 text-[#C084FC]" />
                  <span>Move-in Date</span>
                </label>
                <input
                  type="date"
                  className="w-full bg-transparent text-xs font-medium text-white outline-none cursor-pointer"
                />
              </div>

              {/* Room Type */}
              <div className="p-2.5 px-3 rounded-2xl bg-[#1A1A1C] border border-[#262626] text-left">
                <label className="block text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <Users className="w-3 h-3 text-[#C084FC]" />
                  <span>Room Type</span>
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full bg-transparent text-xs font-medium text-white outline-none cursor-pointer"
                >
                  <option value="All" className="bg-[#141416]">Any Type</option>
                  <option value="Single" className="bg-[#141416]">Single Deluxe</option>
                  <option value="Double" className="bg-[#141416]">Double Sharing</option>
                  <option value="Quad" className="bg-[#141416]">Quad Student Dorm</option>
                  <option value="Studio" className="bg-[#141416]">Studio / Loft</option>
                </select>
              </div>

              {/* Budget */}
              <div className="p-2.5 px-3 rounded-2xl bg-[#1A1A1C] border border-[#262626] text-left">
                <label className="block text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <DollarSign className="w-3 h-3 text-[#C084FC]" />
                  <span>Max Budget (₱{maxBudget.toLocaleString()})</span>
                </label>
                <input
                  type="range"
                  min="2500"
                  max="12000"
                  step="500"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(Number(e.target.value))}
                  className="w-full accent-[#C084FC] h-1.5 bg-[#262626] rounded-lg cursor-pointer"
                />
              </div>

              {/* Search Rooms Button */}
              <a
                href="#room-listings"
                className="w-full h-full min-h-[50px] rounded-2xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black font-bold uppercase tracking-wider text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#C084FC]/20 active:scale-95"
              >
                <Search className="w-4 h-4" />
                <span>Search Rooms</span>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ROOM LISTINGS EXPLORER SECTION */}
      <section id="room-listings" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold text-[#C084FC] uppercase tracking-wider">Available Accommodations</span>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white mt-1">
              Featured Rooms & Boarding Spaces
            </h2>
            <p className="text-xs sm:text-sm text-[#9CA3AF] mt-1">
              Showing {filteredRooms.length} verified listings ready for occupancy
            </p>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterGender}
              onChange={(e) => setFilterGender(e.target.value)}
              className="p-2 px-3 rounded-xl bg-[#141416] border border-[#262626] text-xs text-[#F3F4F6] outline-none"
            >
              <option value="All">All Gender Rules</option>
              <option value="Female Only">Female Only</option>
              <option value="Male Only">Male Only</option>
              <option value="All / Mixed">Mixed / Co-ed</option>
            </select>

            <select
              value={filterAmenity}
              onChange={(e) => setFilterAmenity(e.target.value)}
              className="p-2 px-3 rounded-xl bg-[#141416] border border-[#262626] text-xs text-[#F3F4F6] outline-none"
            >
              <option value="All">All Amenities</option>
              <option value="Aircon">Air Conditioned</option>
              <option value="WiFi">High-Speed WiFi</option>
              <option value="Bathroom">Private Bathroom</option>
              <option value="Desk">Study Desk</option>
            </select>
          </div>
        </div>

        {/* Room Cards Grid */}
        {filteredRooms.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-[#141416] border border-[#262626]">
            <Building2 className="w-12 h-12 text-[#6B7280] mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No rooms matched your filter</h3>
            <p className="text-xs text-[#6B7280] mt-1 mb-4">Try adjusting your budget slider or location keywords</p>
            <button
              onClick={() => {
                setLocationSearch('');
                setSelectedType('All');
                setMaxBudget(10000);
                setFilterGender('All');
                setFilterAmenity('All');
              }}
              className="px-4 py-2 rounded-xl bg-[#C084FC] text-black font-bold uppercase text-xs"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredRooms.map((room) => {
              const isLiked = likedRooms.has(room.id);
              const isFull = room.occupiedCount >= room.capacity;

              return (
                <div
                  key={room.id}
                  onClick={() => onSelectRoom(room)}
                  className="rounded-3xl bg-[#141416] border border-[#262626] overflow-hidden hover:border-[#C084FC]/50 transition-all duration-300 flex flex-col group cursor-pointer shadow-lg hover:shadow-2xl hover:-translate-y-1"
                >
                  {/* Photo & Badge */}
                  <div className="relative aspect-[4/3] bg-[#0A0A0B] overflow-hidden">
                    <img
                      src={room.photos[0]}
                      alt={room.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />

                    {/* Room Type Tag */}
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#0A0A0B]/80 backdrop-blur-md border border-[#262626] text-[11px] font-semibold text-white">
                      {room.roomType}
                    </div>

                    {/* Like / Favorite & Share */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onShareRoom(room);
                        }}
                        className="p-2 rounded-full bg-[#0A0A0B]/80 backdrop-blur-md text-[#9CA3AF] hover:text-[#C084FC] transition-colors border border-[#262626]"
                        title="Share this room"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => toggleLike(room.id, e)}
                        className={`p-2 rounded-full bg-[#0A0A0B]/80 backdrop-blur-md transition-colors border border-[#262626] ${
                          isLiked ? 'text-[#C084FC]' : 'text-[#9CA3AF] hover:text-[#C084FC]'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-[#C084FC]' : ''}`} />
                      </button>
                    </div>

                    {/* Status Pill */}
                    <div className="absolute bottom-3 left-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        isFull 
                          ? 'bg-rose-950/90 text-rose-300 border border-rose-700' 
                          : 'bg-emerald-950/90 text-emerald-300 border border-emerald-700'
                      }`}>
                        {isFull ? 'Occupied' : `Available (${room.capacity - room.occupiedCount} Slots)`}
                      </span>
                    </div>

                    {/* Rating */}
                    <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-[#0A0A0B]/90 border border-[#262626] text-[11px] font-medium text-white flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span>{room.rating}</span>
                    </div>
                  </div>

                  {/* Room Details */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="text-[11px] text-[#6B7280] flex items-center gap-1 mb-1">
                        <MapPin className="w-3 h-3 text-[#C084FC] shrink-0" />
                        <span className="truncate">{room.propertyName} • {room.city}</span>
                      </div>
                      <h3 className="font-semibold text-sm text-white group-hover:text-[#C084FC] transition-colors line-clamp-1">
                        Room #{room.roomNumber} - {room.title}
                      </h3>
                      <p className="text-xs text-[#9CA3AF] line-clamp-2 mt-1">
                        {room.description}
                      </p>
                    </div>

                    {/* Amenities chips */}
                    <div className="flex flex-wrap gap-1">
                      {room.amenities.slice(0, 2).map((a, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-[#1A1A1C] text-[10px] text-[#9CA3AF] border border-[#262626]">
                          {a}
                        </span>
                      ))}
                      {room.amenities.length > 2 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-[#1A1A1C] text-[10px] text-[#6B7280] border border-[#262626]">
                          +{room.amenities.length - 2} more
                        </span>
                      )}
                    </div>

                    {/* Pricing & CTA */}
                    <div className="pt-3 border-t border-[#262626] flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-[#6B7280]">Monthly</span>
                        <div className="font-serif font-bold text-base text-[#C084FC]">
                          ₱{room.priceMonthly.toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRoom(room);
                        }}
                        className="p-2 px-3 rounded-xl bg-[#1A1A1C] hover:bg-[#C084FC] text-white hover:text-black border border-[#262626] text-xs font-semibold flex items-center gap-1 transition-all"
                      >
                        <span>Details</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* AMENITIES & FEATURES SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold text-[#C084FC] uppercase tracking-wider">Modern Boarding Standards</span>
          <h2 className="text-3xl font-serif font-bold text-white mt-1">
            Built for Study, Safety & Serenity
          </h2>
          <p className="text-xs sm:text-sm text-[#9CA3AF] mt-2">
            Every Residenz certified property is equipped with top-tier utilities so you can concentrate on your studies and career.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1A1A1C] border border-[#262626] flex items-center justify-center text-[#C084FC]">
              <Wifi className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-semibold text-base text-white">Gigabit WiFi & Study Lounges</h3>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              Dedicated high-speed mesh networks and soundproofed common study zones designed for exam preparation and remote meetings.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1A1A1C] border border-[#262626] flex items-center justify-center text-[#C084FC]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-semibold text-base text-white">Biometric & 24/7 CCTV Security</h3>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              Rest easy with keyless biometric door entry, round-the-clock recorded corridors, and on-duty building caretakers.
            </p>
          </div>

          <div className="p-6 rounded-3xl bg-[#141416] border border-[#262626] space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1A1A1C] border border-[#262626] flex items-center justify-center text-[#C084FC]">
              <DollarSign className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-semibold text-base text-white">Transparent Digital Invoicing</h3>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              Track electric submeters, water dues, and monthly rent history with instant GCash and bank payment receipts.
            </p>
          </div>
        </div>
      </section>

      {/* PORTAL ACCESS BANNER */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20">
        <div className="rounded-3xl bg-gradient-to-r from-[#1A1A1C] via-[#141416] to-[#0A0A0B] border border-[#C084FC]/30 p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl">
          <div className="space-y-3 text-left">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#C084FC] text-black uppercase tracking-wider">
              Management Portals
            </span>
            <h3 className="text-2xl sm:text-3xl font-serif font-bold text-white">
              Are you a Dorm Owner or Current Tenant?
            </h3>
            <p className="text-xs sm:text-sm text-[#9CA3AF] max-w-xl">
              Access your personalized control center to manage room listings, track rent payments, submit maintenance tickets, or view system analytics.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigateToPortal('owner')}
              className="px-5 py-3 rounded-xl bg-[#1A1A1C] hover:bg-[#262626] border border-[#262626] text-white text-xs font-semibold transition-colors"
            >
              Dorm Owner Login
            </button>
            <button
              onClick={() => onNavigateToPortal('tenant')}
              className="px-5 py-3 rounded-xl bg-[#C084FC] hover:bg-[#d8b4fe] text-black text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-[#C084FC]/20"
            >
              Tenant Portal
            </button>
          </div>
        </div>
      </section>

      {/* Video Tour Modal */}
      {showVideoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0A0A0B]/90 backdrop-blur-md">
          <div className="relative w-full max-w-2xl bg-[#141416] border border-[#262626] rounded-3xl p-6 shadow-2xl text-[#F3F4F6]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif font-semibold text-white text-base">Residenz Virtual Property Tour</h3>
              <button
                onClick={() => setShowVideoModal(false)}
                className="p-1 rounded-lg text-[#6B7280] hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="aspect-video rounded-2xl overflow-hidden bg-[#0A0A0B] border border-[#262626] relative group flex items-center justify-center">
              <img
                src="https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1200&q=80"
                alt="Room Tour"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-center p-4">
                <div className="w-14 h-14 rounded-full bg-[#C084FC] flex items-center justify-center text-black shadow-xl mb-3 animate-pulse">
                  <Play className="w-6 h-6 fill-black ml-0.5" />
                </div>
                <p className="font-semibold text-white text-sm">Interactive 4K Video Tour Ready</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Simulating high-definition walk-through of boarding facility amenities</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
