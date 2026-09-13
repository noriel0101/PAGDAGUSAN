import {
	Announcement, AuditLog, ChatMessage, MaintenanceRequest, PaymentRecord,
	RoomListing, TenantLease, UserProfile
} from '../types';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, {
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
		...options
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(payload.error || 'The server could not complete the request.');
	const data = payload.data ?? payload;
	if (options.method && options.method !== 'GET') window.dispatchEvent(new Event('boardease:data-changed'));
	return data;
}

export const api = {
	health: () => request<{ status: string }>('/health'),
	getCurrentUser: () => request<UserProfile | null>('/auth/me'),
	login: (email: string, password: string) => request<UserProfile>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
	register: (input: { name: string; email: string; password: string; role: UserProfile['role'] }) => request<UserProfile>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	getUsers: () => request<UserProfile[]>('/users'),
	getUser: (id: string) => request<UserProfile>(`/users/${id}`),
	createUser: (user: Partial<UserProfile>) => request<UserProfile>('/users', { method: 'POST', body: JSON.stringify(user) }),
	updateUser: (id: string, user: Partial<UserProfile>) => request<UserProfile>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(user) }),
	getRooms: () => request<RoomListing[]>('/rooms'),
	getRoom: (id: string) => request<RoomListing>(`/rooms/${id}`),
	addRoom: (room: RoomListing) => request<RoomListing>('/rooms', { method: 'POST', body: JSON.stringify(room) }),
	updateRoom: (id: string, room: Partial<RoomListing>) => request<RoomListing>(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(room) }),
	deleteRoom: (id: string) => request<void>(`/rooms/${id}`, { method: 'DELETE' }),
	getLeases: () => request<TenantLease[]>('/leases'),
	getLease: (id: string) => request<TenantLease>(`/leases/${id}`),
	addLease: (lease: TenantLease) => request<TenantLease>('/leases', { method: 'POST', body: JSON.stringify(lease) }),
	updateLease: (id: string, lease: Partial<TenantLease>) => request<TenantLease>(`/leases/${id}`, { method: 'PUT', body: JSON.stringify(lease) }),
	getPayments: () => request<PaymentRecord[]>('/payments'),
	getPayment: (id: string) => request<PaymentRecord>(`/payments/${id}`),
	addPayment: (payment: PaymentRecord) => request<PaymentRecord>('/payments', { method: 'POST', body: JSON.stringify(payment) }),
	updatePaymentStatus: (id: string, status: PaymentRecord['status'], notes?: string) => request<PaymentRecord>(`/payments/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, notes }) }),
	getMaintenanceRequests: () => request<MaintenanceRequest[]>('/maintenance'),
	getMaintenanceRequest: (id: string) => request<MaintenanceRequest>(`/maintenance/${id}`),
	addMaintenanceRequest: (requestData: MaintenanceRequest) => request<MaintenanceRequest>('/maintenance', { method: 'POST', body: JSON.stringify(requestData) }),
	updateMaintenanceStatus: (id: string, status: MaintenanceRequest['status'], resolutionNotes?: string) => request<MaintenanceRequest>(`/maintenance/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, resolutionNotes }) }),
	getAnnouncements: () => request<Announcement[]>('/announcements'),
	addAnnouncement: (announcement: Announcement) => request<Announcement>('/announcements', { method: 'POST', body: JSON.stringify(announcement) }),
	updateAnnouncement: (id: string, announcement: Partial<Announcement>) => request<Announcement>(`/announcements/${id}`, { method: 'PUT', body: JSON.stringify(announcement) }),
	toggleLikeAnnouncement: (id: string) => request<Announcement>(`/announcements/${id}/like`, { method: 'POST' }),
	getMessages: () => request<ChatMessage[]>('/messages'),
	sendMessage: (message: ChatMessage) => request<ChatMessage>('/messages', { method: 'POST', body: JSON.stringify(message) }),
	markMessageRead: (id: string) => request<ChatMessage>(`/messages/${id}/read`, { method: 'PUT' }),
	getAuditLogs: () => request<AuditLog[]>('/audit-logs')
};
