export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  username: string;
  shippingAddress: ShippingAddress | null;
  wantBaseCards: boolean;
  legacyUser: boolean;
  balance: number;
  purchaseCount: number;
  fcmToken: string | null;
  createdAt: Date | null;
}
