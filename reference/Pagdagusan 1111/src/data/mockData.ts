import { RoomListing, UserProfile, TenantLease, PaymentRecord, MaintenanceRequest, Announcement, AuditLog, ChatMessage } from '../types';

export const INITIAL_USERS: UserProfile[] = [
  {
    id: 'user-admin-1',
    name: 'Jupiter desuyo',
    email: 'admin@boardease.com',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    phone: '+63 917 555 0199',
    joinedDate: '2025-01-15',
    status: 'active'
  },
  {
    id: 'user-owner-1',
    name: 'Carlos Mendoza',
    email: 'carlos.mendoza@boardease.com',
    role: 'owner',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    phone: '+63 928 444 8821',
    propertyAssigned: 'BoardEase Prime Residences',
    joinedDate: '2025-02-01',
    status: 'active'
  },
  {
    id: 'user-tenant-1',
    name: 'Aira Santos',
    email: 'aira.santos@student.edu',
    role: 'tenant',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
    phone: '+63 939 123 4567',
    propertyAssigned: 'BoardEase Prime Residences',
    roomNumber: 'Room 101',
    joinedDate: '2025-05-10',
    status: 'active'
  },
  {
    id: 'user-tenant-2',
    name: 'Mark Reyes',
    email: 'mark.reyes@techmail.com',
    role: 'tenant',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
    phone: '+63 915 888 2345',
    propertyAssigned: 'BoardEase Prime Residences',
    roomNumber: 'Room 102',
    joinedDate: '2025-06-01',
    status: 'active'
  }
];

export const INITIAL_ROOMS: RoomListing[] = [
  {
    id: 'room-101',
    title: 'Modern Deluxe Studio with Balcony',
    roomNumber: '101',
    propertyName: 'BoardEase Prime Residences',
    address: '42 University Belt Avenue, Sampaloc',
    city: 'Manila',
    priceMonthly: 6500,
    depositAmount: 6500,
    capacity: 2,
    occupiedCount: 1,
    status: 'available',
    roomType: 'Single Deluxe',
    genderPreference: 'All / Mixed',
    amenities: [
      'Inverter Air Conditioner',
      'High-Speed 200Mbps Fiber WiFi',
      'Private Bathroom w/ Water Heater',
      'Ergonomic Study Desk & Lamp',
      'Personal Refrigerator',
      '24/7 Security & CCTV Access',
      'Biometric Door Lock',
      'Submetered Electricity'
    ],
    photos: [
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1540518614846-7ede433c4b49?auto=format&fit=crop&w=1200&q=80'
    ],
    description: 'Designed specifically for focused university students and working professionals. Features floor-to-ceiling windows, sound insulation, custom built-in wardrobe, and dedicated high-speed fiber internet port.',
    rating: 4.9,
    reviewsCount: 28,
    ownerId: 'user-owner-1',
    ownerName: 'Carlos Mendoza',
    ownerPhone: '+63 928 444 8821',
    ownerEmail: 'carlos.mendoza@boardease.com',
    createdAt: '2025-01-10',
    featured: true
  },
  {
    id: 'room-102',
    title: 'Twin Executive Sharing Suite',
    roomNumber: '102',
    propertyName: 'BoardEase Prime Residences',
    address: '42 University Belt Avenue, Sampaloc',
    city: 'Manila',
    priceMonthly: 4200,
    depositAmount: 4200,
    capacity: 2,
    occupiedCount: 2,
    status: 'full',
    roomType: 'Double Sharing',
    genderPreference: 'Male Only',
    amenities: [
      'Split-Type Aircon',
      'WiFi Mesh Coverage',
      'Attached Bathroom',
      'Dual Study Pods with Bookcase',
      'Individual Keycard Lockers',
      'CCTV Corridors',
      'Filtered Drinking Water Station'
    ],
    photos: [
      'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80'
    ],
    description: 'Spacious double sharing room equipped with premium bunk bed arrangement, individual study desks, and private electrical metering.',
    rating: 4.8,
    reviewsCount: 19,
    ownerId: 'user-owner-1',
    ownerName: 'Carlos Mendoza',
    ownerPhone: '+63 928 444 8821',
    ownerEmail: 'carlos.mendoza@boardease.com',
    createdAt: '2025-01-15',
    featured: true
  },
  {
    id: 'room-103',
    title: 'Quad Quad-Bunk Student Dorm',
    roomNumber: '103',
    propertyName: 'BoardEase Prime Residences',
    address: '42 University Belt Avenue, Sampaloc',
    city: 'Manila',
    priceMonthly: 3200,
    depositAmount: 3200,
    capacity: 4,
    occupiedCount: 1,
    status: 'available',
    roomType: 'Quad Dorm',
    genderPreference: 'Female Only',
    amenities: [
      'Air Conditioner (Timed Eco)',
      'High-Speed WiFi',
      '2 Shared Clean Restrooms',
      'Individual Reading Lights',
      'Heavy Duty Steel Lockers',
      'Common Pantry Access',
      'Daily Hallway Housekeeping'
    ],
    photos: [
      'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80'
    ],
    description: 'Budget-friendly shared student dormitory with high privacy curtains for each bunk, personal electrical sockets, and secure badge access.',
    rating: 4.7,
    reviewsCount: 34,
    ownerId: 'user-owner-1',
    ownerName: 'Carlos Mendoza',
    ownerPhone: '+63 928 444 8821',
    ownerEmail: 'carlos.mendoza@boardease.com',
    createdAt: '2025-02-01',
    featured: false
  },
  {
    id: 'room-104',
    title: 'Penthouse Loft Studio with Skylight',
    roomNumber: '201',
    propertyName: 'BoardEase Heights Katipunan',
    address: '88 Katipunan Avenue, Loyola Heights',
    city: 'Quezon City',
    priceMonthly: 9800,
    depositAmount: 9800,
    capacity: 1,
    occupiedCount: 0,
    status: 'available',
    roomType: 'Studio',
    genderPreference: 'All / Mixed',
    amenities: [
      'Smart Inverter Aircon',
      'WiFi 6 Router in Room',
      'Ensuite Bathroom with Rain Shower',
      'Mini Kitchenette with Microwave & Induction',
      'Balcony with Skyline View',
      'Smart TV w/ Netflix',
      'Gym & Roof Deck Access'
    ],
    photos: [
      'https://images.unsplash.com/photo-1502005229762-ee1b2da9cce0?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80'
    ],
    description: 'Premium standalone penthouse unit designed for postgraduate researchers or young professionals seeking serene comfort and modern amenities.',
    rating: 5.0,
    reviewsCount: 12,
    ownerId: 'user-owner-1',
    ownerName: 'Carlos Mendoza',
    ownerPhone: '+63 928 444 8821',
    ownerEmail: 'carlos.mendoza@boardease.com',
    createdAt: '2025-02-20',
    featured: true
  }
];

export const INITIAL_LEASES: TenantLease[] = [
  {
    id: 'lease-1',
    tenantId: 'user-tenant-1',
    tenantName: 'Aira Santos',
    tenantEmail: 'aira.santos@student.edu',
    tenantPhone: '+63 939 123 4567',
    roomId: 'room-101',
    roomNumber: '101',
    propertyName: 'BoardEase Prime Residences',
    startDate: '2025-05-15',
    endDate: '2026-05-14',
    monthlyRent: 6500,
    depositPaid: 6500,
    status: 'active',
    emergencyContact: {
      name: 'Elena Santos',
      relationship: 'Mother',
      phone: '+63 917 999 1234'
    }
  },
  {
    id: 'lease-2',
    tenantId: 'user-tenant-2',
    tenantName: 'Mark Reyes',
    tenantEmail: 'mark.reyes@techmail.com',
    tenantPhone: '+63 915 888 2345',
    roomId: 'room-102',
    roomNumber: '102',
    propertyName: 'BoardEase Prime Residences',
    startDate: '2025-06-01',
    endDate: '2026-05-31',
    monthlyRent: 4200,
    depositPaid: 4200,
    status: 'active',
    emergencyContact: {
      name: 'Robert Reyes',
      relationship: 'Father',
      phone: '+63 918 333 4567'
    }
  }
];

export const INITIAL_PAYMENTS: PaymentRecord[] = [
  {
    id: 'pay-101',
    invoiceNo: 'INV-2025-08-001',
    tenantId: 'user-tenant-1',
    tenantName: 'Aira Santos',
    roomNumber: '101',
    propertyName: 'BoardEase Prime Residences',
    amount: 6500,
    monthCovered: 'August 2025',
    dueDate: '2025-08-15',
    paidDate: '2025-08-14',
    paymentMethod: 'GCash',
    referenceNumber: 'GCASH-9831448201',
    status: 'paid',
    notes: 'Paid via GCash e-wallet on time',
    createdAt: '2025-08-14'
  },
  {
    id: 'pay-102',
    invoiceNo: 'INV-2025-08-002',
    tenantId: 'user-tenant-2',
    tenantName: 'Mark Reyes',
    roomNumber: '102',
    propertyName: 'BoardEase Prime Residences',
    amount: 4200,
    monthCovered: 'August 2025',
    dueDate: '2025-08-05',
    paidDate: '2025-08-04',
    paymentMethod: 'Maya',
    referenceNumber: 'MAYA-401928371',
    status: 'paid',
    notes: 'Paid ahead of cutoff',
    createdAt: '2025-08-04'
  },
  {
    id: 'pay-103',
    invoiceNo: 'INV-2025-09-001',
    tenantId: 'user-tenant-1',
    tenantName: 'Aira Santos',
    roomNumber: '101',
    propertyName: 'BoardEase Prime Residences',
    amount: 2500,
    monthCovered: 'September 2025 (Partial/Utility)',
    dueDate: '2025-09-15',
    paymentMethod: 'GCash',
    referenceNumber: 'GC-99238411',
    status: 'pending',
    notes: 'Utility + Partial Rent pending verification',
    createdAt: '2025-08-30'
  }
];

export const INITIAL_MAINTENANCE: MaintenanceRequest[] = [
  {
    id: 'maint-1',
    ticketNo: 'MNT-101-01',
    tenantId: 'user-tenant-1',
    tenantName: 'Aira Santos',
    tenantPhone: '+63 939 123 4567',
    roomId: 'room-101',
    roomNumber: '101',
    propertyName: 'BoardEase Prime Residences',
    category: 'Plumbing',
    title: 'Room 101 Bathroom Faucet Slight Leak',
    description: 'The cold water knob under the bathroom basin has a slow dripping leak. Need plumber tightening.',
    priority: 'medium',
    status: 'pending',
    photos: [
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=800&q=80'
    ],
    submittedAt: '2025-08-28 09:30 AM',
    updatedAt: '2025-08-28 09:30 AM',
    assignedStaff: 'Kuya Ben (Building Caretaker)'
  },
  {
    id: 'maint-2',
    ticketNo: 'MNT-102-02',
    tenantId: 'user-tenant-2',
    tenantName: 'Mark Reyes',
    tenantPhone: '+63 915 888 2345',
    roomId: 'room-102',
    roomNumber: '102',
    propertyName: 'BoardEase Prime Residences',
    category: 'Aircon / HVAC',
    title: 'Aircon Filter Cleaning Routine',
    description: 'Requesting quarterly air conditioner filter clean and condenser inspection for cooling efficiency.',
    priority: 'low',
    status: 'completed',
    photos: [],
    submittedAt: '2025-08-10 02:15 PM',
    updatedAt: '2025-08-11 11:00 AM',
    assignedStaff: 'CoolTech Aircon Services',
    resolutionNotes: 'Aircon filter washed and refrigerant gas topped up. Clean and fully functioning.'
  }
];

export const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-1',
    title: 'Scheduled Water Tank Cleaning Interruption',
    content: 'Please be advised that the main rooftop water tank will undergo scheduled sanitation tomorrow from 8:00 AM to 5:00 PM. Kindly store ample water for morning use.',
    type: 'maintenance',
    audience: 'all',
    propertyName: 'BoardEase Prime Residences',
    authorName: 'Carlos Mendoza (Owner)',
    authorRole: 'Dorm Owner',
    createdAt: '2025-08-30 08:00 AM',
    pinned: true,
    likesCount: 14
  },
  {
    id: 'ann-2',
    title: 'Rent Due Date Reminder for September',
    content: 'Friendly reminder to all tenants: September monthly rental and utility cut-offs are scheduled for the 5th and 15th. You may settle seamlessly through GCash or Bank upload in your tenant portal.',
    type: 'payment_reminder',
    audience: 'tenants',
    propertyName: 'BoardEase Prime Residences',
    authorName: 'Jupiter desuyo (Admin)',
    authorRole: 'System Admin',
    createdAt: '2025-08-29 10:30 AM',
    pinned: false,
    likesCount: 8
  },
  {
    id: 'ann-3',
    title: 'New High-Speed Fiber Mesh WiFi Activated',
    content: 'We have upgraded all floor access points to WiFi 6 mesh nodes. Enjoy uninterrupted online classes and remote work speeds!',
    type: 'community',
    audience: 'all',
    propertyName: 'BoardEase Prime Residences',
    authorName: 'Carlos Mendoza (Owner)',
    authorRole: 'Dorm Owner',
    createdAt: '2025-08-20 03:00 PM',
    pinned: false,
    likesCount: 22
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: '2025-08-31 09:12 AM',
    action: 'Payment Recorded',
    actorName: 'Aira Santos',
    actorRole: 'Tenant',
    details: 'Submitted GCash reference GC-99238411 for Room 101 (₱2,500.00)',
    status: 'info'
  },
  {
    id: 'log-2',
    timestamp: '2025-08-30 04:45 PM',
    action: 'Maintenance Logged',
    actorName: 'Aira Santos',
    actorRole: 'Tenant',
    details: 'Created ticket MNT-101-01 (Plumbing issue)',
    status: 'warning'
  },
  {
    id: 'log-3',
    timestamp: '2025-08-30 08:00 AM',
    action: 'Broadcast Announcement',
    actorName: 'Carlos Mendoza',
    actorRole: 'Dorm Owner',
    details: 'Published Water Tank Interruption notice',
    status: 'info'
  },
  {
    id: 'log-4',
    timestamp: '2025-08-28 01:20 PM',
    action: 'User Role Verified',
    actorName: 'Jupiter desuyo',
    actorRole: 'Admin',
    details: 'Approved partner agency listing profile #5',
    status: 'success'
  }
];

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    senderId: 'user-owner-1',
    senderName: 'Carlos Mendoza (Owner)',
    senderRole: 'owner',
    senderAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    recipientId: 'user-tenant-1',
    recipientName: 'Aira Santos',
    content: 'Hi Aira! We received your plumbing ticket. Kuya Ben will drop by today around 2 PM to check the bathroom faucet.',
    timestamp: '2025-08-30 10:15 AM',
    read: true
  },
  {
    id: 'msg-2',
    senderId: 'user-tenant-1',
    senderName: 'Aira Santos',
    senderRole: 'tenant',
    senderAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
    recipientId: 'user-owner-1',
    recipientName: 'Carlos Mendoza (Owner)',
    content: 'Thank you Sir Carlos! I will be inside studying during that time.',
    timestamp: '2025-08-30 10:20 AM',
    read: true
  }
];
