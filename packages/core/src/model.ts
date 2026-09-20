export type StableId = string;
export type IsoDate = string; // YYYY-MM-DD

export interface Company {
  id: StableId;
  name: string;
  contact_email: string;
}

export interface WorkArea {
  id: StableId;
  name: string;
  location: string;
  poc_name: string;
  poc_email: string;
  poc_phone_number: string;
  description: string;
}

export interface ChemicalProduct {
  id: StableId;
  chemical_names?: string | null;
  product_name: string;
  cas_numbers?: string | null;
  manufacturer: string;
  sds_date: IsoDate;
}

export interface Worker {
  id: StableId;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface SdsVerification {
  id: StableId;
  verified_at: IsoDate;
}

export interface TrainingEvent {
  id: StableId;
  training_date: IsoDate;
}

export interface WorkAreaProduct {
  id: StableId;
  quantity: string;
  storage_location: string;
  added_date: IsoDate;
}

export interface WorkAreaAssignment {
  id: StableId;
  assigned_date: IsoDate;
  ended_date?: IsoDate | null;
  training_required_since: IsoDate;
}

export interface HazcomReview {
  id: StableId;
  review_date: IsoDate;
}

export const RELATIONSHIP_IDS = {
  companyWorkArea: '10f4ef7a-86c3-4f4d-9d33-cff2c0eee738',
  companyChemicalProduct: '940a4d09-5250-4b89-9911-1ac6f4ba64cf',
  companyWorker: '1e679f94-12b0-4d70-839e-d54c064f5ab1',
  chemicalProductSdsVerification: '7b8f5523-3a5c-4bfa-bf83-e5310911ea7b',
  workAreaWorkAreaProduct: '96db12e7-1201-4f03-8a31-3a8fa6c2ab95',
  chemicalProductWorkAreaProduct: '9d42d6cd-a311-4a1e-9358-2d1cc921b641',
  workAreaAssignment: '2915981b-e56b-4e0b-a619-a1fbcf9a6566',
  assignmentTrainingEvent: '609b3aa7-28ab-498b-8b28-287c5232be85',
  workerAssignment: 'd30ac2b9-7aff-4838-9e9e-27deedfe9c38',
  workAreaHazcomReview: '024e4f65-976b-4a77-8323-d4b317e693a1',
} as const;

export const EVENT_ENTITY_KEYS = ['sds_verification', 'training_event', 'hazcom_review'] as const;
export type EventEntityKey = typeof EVENT_ENTITY_KEYS[number];
