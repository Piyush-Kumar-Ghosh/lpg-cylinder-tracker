/**
 * Core domain types for the LPG Cylinder Tracker.
 *
 * Dates are stored as calendar-date strings (`YYYY-MM-DD`), never as `Date`
 * objects or timestamps. A household cares about the *day* a cylinder was
 * delivered, not the instant — and storing calendar dates removes every
 * timezone off-by-one hazard. See `src/domain/dates.ts`.
 */

/** A calendar date with no time or timezone component, e.g. `"2026-09-04"`. */
export type ISODate = string;

/** An ISO-8601 instant, used only for record bookkeeping (createdAt/updatedAt). */
export type ISOTimestamp = string;

/* ------------------------------------------------------------------ status -- */

export const CYLINDER_STATUSES = [
  'booked',
  'delivered',
  'stored',
  'in_use',
  'empty',
  'returned',
] as const;

export type CylinderStatus = (typeof CYLINDER_STATUSES)[number];

export const STATUS_LABELS: Record<CylinderStatus, string> = {
  booked: 'Booked',
  delivered: 'Delivered',
  stored: 'Stored / Spare',
  in_use: 'In Use',
  empty: 'Empty',
  returned: 'Returned',
};

/** Short glyph shown next to every status label so status never relies on colour alone. */
export const STATUS_GLYPHS: Record<CylinderStatus, string> = {
  booked: '◷',
  delivered: '▣',
  stored: '⬒',
  in_use: '◉',
  empty: '○',
  returned: '↩',
};

/* --------------------------------------------------------- special usage -- */

export const SPECIAL_USAGES = [
  'normal',
  'guests',
  'festival',
  'heavy_cooking',
  'low_usage',
  'vacation',
  'other',
] as const;

export type SpecialUsage = (typeof SPECIAL_USAGES)[number];

export const SPECIAL_USAGE_LABELS: Record<SpecialUsage, string> = {
  normal: 'Normal',
  guests: 'Guests',
  festival: 'Festival',
  heavy_cooking: 'Heavy cooking',
  low_usage: 'Low usage',
  vacation: 'Vacation',
  other: 'Other',
};

/* --------------------------------------------------------------- company -- */

/** Companies that ship with the app. Users may add their own in Settings. */
export const BUILT_IN_COMPANIES = [
  'Indane / Indian Oil',
  'HP Gas / Hindustan Petroleum',
  'Bharatgas / Bharat Petroleum',
  'Other',
] as const;

/* -------------------------------------------------------------- cylinder -- */

/**
 * One physical refill cycle: booked → delivered → started → empty.
 *
 * Money is held as two pairs. The *estimate* pair is what the household
 * expected when booking; the *actual* pair is what they really paid on
 * delivery. Every financial calculation prefers the actual value and only
 * falls back to the estimate when no actual figure exists yet
 * (see `effectiveCylinderCost` in `src/domain/calculations/financial.ts`).
 */
export interface Cylinder {
  /** Stable sequential internal id assigned by the database. Not the printed serial. */
  id: number;

  company: string;
  status: CylinderStatus;

  bookingDate: ISODate | null;
  deliveryDate: ISODate | null;
  /** Installation / start-of-use date. Independently editable from deliveryDate. */
  startDate: ISODate | null;
  /** Empty / finish date. `null` while the cylinder is still in use. */
  finishDate: ISODate | null;

  /** Expected refill charge captured at booking time. */
  estimatedCylinderCost: number | null;
  /** Expected delivery charge captured at booking time. */
  estimatedDeliveryFee: number | null;
  /** Refill charge actually paid, captured at delivery. */
  actualCylinderCost: number | null;
  /** Delivery charge actually paid, captured at delivery. */
  actualDeliveryFee: number | null;
  /** Subsidy credited for this cylinder. Never negative. Defaults to 0. */
  subsidy: number;

  specialUsage: SpecialUsage;
  notes: string;
  /** Optional number printed on the physical cylinder. Distinct from `id`. */
  serialNumber: string;

  /** True only for records created by Demo Mode. Demo and real data never mix. */
  isDemo: boolean;

  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  /** Record-level schema version, used by `src/storage/migrations.ts`. */
  schemaVersion: number;
}

/** A cylinder before the database has assigned its id. */
export type NewCylinder = Omit<Cylinder, 'id'>;

/** The subset of a cylinder a user may edit directly. */
export type CylinderDraft = Omit<
  Cylinder,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'isDemo'
>;

/* -------------------------------------------------------------- settings -- */

export const PREDICTION_METHODS = ['median', 'mean', 'weighted'] as const;
export type PredictionMethod = (typeof PREDICTION_METHODS)[number];

export const PREDICTION_METHOD_LABELS: Record<PredictionMethod, string> = {
  median: 'Median (robust — recommended)',
  mean: 'Mean (simple average)',
  weighted: 'Weighted average (recent cylinders count more)',
};

export const REPORT_BASES = ['booking', 'delivery', 'start', 'finish'] as const;
export type ReportBasis = (typeof REPORT_BASES)[number];

export const REPORT_BASIS_LABELS: Record<ReportBasis, string> = {
  booking: 'Booking date',
  delivery: 'Delivery date',
  start: 'Start / installation date',
  finish: 'Empty / finish date',
};

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  /** Single-row primary key. Always `1`. */
  id: 1;

  /* Household */
  householdName: string;
  householdMembers: number | null;
  city: string;
  currency: string;

  /* LPG */
  deliveryBufferDays: number;
  preferredCompany: string;
  customCompanies: string[];
  cylinderWeightKg: number | null;
  defaultSpecialUsage: SpecialUsage;
  /** User-selected cylinder to feature when more than one is marked in use. */
  primaryCylinderId: number | null;

  /* Prediction */
  predictionMethod: PredictionMethod;
  /**
   * When true, the in-use cylinder's elapsed days are added to the historical
   * sample. Off by default so an unfinished cylinder cannot drag the average down.
   */
  includeCurrentInAverages: boolean;

  /* Notifications */
  bookingRemindersEnabled: boolean;
  bookingReminderLeadDays: number;
  emptyRemindersEnabled: boolean;
  emptyReminderLeadDays: number;
  missingInfoRemindersEnabled: boolean;
  /** Mirror of the browser permission the user granted in Settings. */
  systemNotificationsEnabled: boolean;

  /* App */
  demoMode: boolean;
  theme: ThemePreference;
  defaultReportBasis: ReportBasis;
  schemaVersion: number;
}

/* ------------------------------------------------------------------ misc -- */

export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high';

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  none: 'Not enough historical data yet',
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};
