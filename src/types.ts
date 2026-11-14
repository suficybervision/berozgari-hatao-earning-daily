export type OrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AppView = 'home' | 'checkout' | 'dashboard' | 'admin';

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
  orderId: string;
  userId: string;
  name: string;
  mobile: string;
  email: string;
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
