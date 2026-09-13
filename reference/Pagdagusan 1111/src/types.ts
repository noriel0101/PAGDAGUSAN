export type UserRole = 'admin' | 'owner' | 'tenant' | 'guest';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  phone?: string;
  propertyAssigned?: string;
  roomNumber?: string;
  joinedDate: string;
  status: 'active' | 'pending' | 'suspended';
}

export interface Amenity {
  id: string;
  name: string;
  icon: string;
}

export interface RoomListing {
  id: string;
  title: string;
  roomNumber: string;
  propertyName: string;
  address: string;
  city: string;
  priceMonthly: number;
  depositAmount: number;
  capacity: number;
  occupiedCount: number;
  status: 'available' | 'full' | 'maintenance' | 'reserved';
  roomType: 'Single Deluxe' | 'Double Sharing' | 'Quad Dorm' | 'Studio' | 'Bedspace';
  genderPreference: 'All / Mixed' | 'Female Only' | 'Male Only';
  amenities: string[];
  photos: string[];
  description: string;
  rating: number;
  reviewsCount: number;
  ownerId: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  createdAt: string;
  featured?: boolean;
}

export interface TenantLease {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  roomId: string;
  roomNumber: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  depositPaid: number;
  status: 'active' | 'pending_approval' | 'expired' | 'terminated';
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
}

export type PaymentMethod = 'GCash' | 'Bank Transfer' | 'Maya' | 'Cash' | 'Credit Card';

export interface PaymentRecord {
  id: string;
  invoiceNo: string;
  tenantId: string;
  tenantName: string;
  roomNumber: string;
  propertyName: string;
  amount: number;
  monthCovered: string;
  dueDate: string;
  paidDate?: string;
  paymentMethod: PaymentMethod;
  proofImageUrl?: string;
  referenceNumber?: string;
  status: 'paid' | 'pending' | 'overdue' | 'rejected';
  notes?: string;
  createdAt: string;
}

export type MaintenanceCategory = 
  | 'Plumbing' 
  | 'Electrical' 
  | 'Aircon / HVAC' 
  | 'Carpentry / Lock' 
  | 'Appliance' 
  | 'WiFi / Internet' 
  | 'Pest Control' 
  | 'General';

export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';
export type MaintenanceStatus = 'pending' | 'reviewing' | 'in_progress' | 'completed' | 'cancelled';

export interface MaintenanceRequest {
  id: string;
  ticketNo: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  roomId: string;
  roomNumber: string;
  propertyName: string;
  category: MaintenanceCategory;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  photos: string[];
  submittedAt: string;
  updatedAt: string;
  assignedStaff?: string;
  resolutionNotes?: string;
  scheduledDate?: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'urgent' | 'maintenance' | 'payment_reminder' | 'community' | 'event';
  audience: 'all' | 'tenants' | 'owners';
  propertyName?: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  pinned: boolean;
  likesCount?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderAvatar: string;
  recipientId: string;
  recipientName: string;
  content: string;
  timestamp: string;
  read: boolean;
  attachmentUrl?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  actorName: string;
  actorRole: string;
  details: string;
  status: 'success' | 'warning' | 'info' | 'danger';
}

