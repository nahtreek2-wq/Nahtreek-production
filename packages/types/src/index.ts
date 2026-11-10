export enum UserRole {
  CLIENT = 'CLIENT',
  ENGINEER = 'ENGINEER',
  ADMIN = 'ADMIN',
}

export enum AccountStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum VerificationStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum EngineerRequestStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface UserDto {
  id: string;
  email?: string;
  phoneNumber: string;
  status: AccountStatus;
  roles: UserRole[];
  createdAt: string;
}

export interface ClientProfileDto {
  id: string;
  userId: string;
  fullName: string;
  avatarUrl?: string;
  email?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}

export interface EngineerProfileDto {
  id: string;
  professionalProfileId: string;
  rankScore?: number;
  rankFactors?: string[];
  isMember?: boolean;
  fullName: string;
  avatarUrl?: string;
  coverUrl?: string;
  qualificationDegree: string;
  institution: string;
  graduationYear: number;
  licenseNumber?: string;
  title: string;
  bio?: string;
  yearsOfExperience: number;
  verificationStatus: VerificationStatus;
  averageRating: number;
  totalReviewsCount: number;
  isAvailable: boolean;
  baseCity: string;
  baseLatitude: number;
  baseLongitude: number;
  specializations: string[];
  consultationFee?: number;
  distanceKm?: number;
  nextSlot?: string;
  serviceAreas?: string[];
  portfolio?: PortfolioItemDto[];
  reviews?: ReviewDto[];
}

export interface EngineerRequestDto {
  id: string;
  clientProfileId: string;
  engineerProfileId: string;
  engineerName: string;
  consultationFee?: number;
  completionCode?: string;
  projectTitle: string;
  projectDescription: string;
  propertyType: string;
  projectSizeSqFt?: number;
  locationAddress: string;
  latitude: number;
  longitude: number;
  status: EngineerRequestStatus;
  createdAt: string;
  review?: {rating: number; comment: string; date: string};
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  content: string;
  attachmentUrl?: string;
  createdAt: string;
}

export interface PortfolioItemDto {
  title: string;
  meta: string;
  imageUrl?: string;
}

export interface ReviewDto {
  name: string;
  rating: number;
  comment: string;
  date: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  subtitle: string;
  professionalName: string;
  otherAvatarUrl?: string;
  engineerRequestId?: string;
  serviceRequestId?: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

export type NotificationKind = 'request' | 'tracking' | 'message' | 'offer';

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  time: string;
  isRead: boolean;
}

export interface FavoriteProfessionalDto {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  title: string;
  verificationStatus: string;
  averageRating: number;
  totalReviewsCount: number;
  isAvailable: boolean;
  baseCity: string;
  startingPrice: number | null;
  engineerProfile: {consultationFee: number | null} | null;
}

export interface FavoriteDto {
  professionalId: string;
  createdAt: string;
  professional?: FavoriteProfessionalDto | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SearchResultDto {
  engineers: EngineerProfileDto[];
}
