export interface SetupWizardOptions {
  logo: string | null;
  companyName: string;
  country: string;
  fullname: string;
  email: string;
  bankName: string;
  currency: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  chartOfAccounts: string;
  organizationNumber?: string | null;
  organizationForm?: string | null;
  vatRegistered?: boolean | null;
  companyAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
}
