export type OrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AppView = 'home' | 'checkout' | 'track' | 'admin';

export interface CourseSettings {
  courseName: string;
  courseDescription: string;
  courseCoverUrl: string;
  originalPrice: number;
  showOriginalPrice: boolean;
  coursePrice: number;
  upiId: string;
  qrCodeUrl: string;
  whatsappNumber: string;
  isAvailable: boolean;
}

export interface OrderRecord {
  orderCode: string;
  name: string;
  mobile: string;
  utr: string;
  screenshotUrl: string;
  amount: number;
  status: OrderStatus;
  rejectionReason: string;
  adminId: string;
  createdAt: Date | null;
  approvedAt: Date | null;
  updatedAt: Date | null;
}

export interface TrackingResult {
  orderCode: string;
  status: OrderStatus;
  rejectionReason: string;
  amount: number;
  createdAt: string | null;
  updatedAt: string | null;
  accessClaimed: boolean;
}

export interface ToastNotice {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

export interface TelegramConfigStatus {
  botTokenConfigured: boolean;
  channelIdConfigured: boolean;
  channelIdMasked: string;
  channelIdValue?: string;
}
