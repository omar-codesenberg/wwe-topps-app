export type EventStatus = 'upcoming' | 'live' | 'closed';
export interface BreakEvent {
  id: string;
  title: string;
  description: string;
  status: EventStatus;
  opensAt: Date;
  closesAt: Date | null;
  imageUrl: string | null;
  totalSlots: number;
  soldSlots: number;
  featuredSlotIds: string[];
  createdAt: Date;
}
