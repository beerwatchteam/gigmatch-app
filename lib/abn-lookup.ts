/**
 * ABN Lookup via the Australian Business Register's JSON web service.
 *
 * SETUP (free, takes ~1 minute):
 *   1. Go to https://abr.business.gov.au/Tools/ABRXMLSearch
 *   2. Click "Register" and fill in your details — you receive a GUID by email (instant).
 *   3. Add the GUID to your .env file as EXPO_PUBLIC_ABR_GUID=your-guid-here
 *
 * The GUID is sent with every request and is safe to include in the client bundle
 * (it identifies the application, not a secret).
 */

// TODO: replace with your GUID from abr.business.gov.au/Tools/ABRXMLSearch
const ABR_GUID = process.env.EXPO_PUBLIC_ABR_GUID ?? '';

export type AbnLookupResult = {
  entityName: string;
  entityType: 'Sole trader' | 'Company' | 'Partnership' | 'Other';
  gstRegistered: boolean;
  abnStatus: 'Active' | 'Cancelled' | string;
  postcode?: string;
  state?: string;
};

export type AbnLookupError = { error: string };

/**
 * Looks up an ABN against the Australian Business Register.
 * Returns null if the GUID is not configured.
 */
export async function lookupABN(abn: string): Promise<AbnLookupResult | AbnLookupError | null> {
  if (!ABR_GUID) return null;

  const digits = abn.replace(/\s/g, '');
  if (digits.length !== 11) return { error: 'ABN must be 11 digits.' };

  try {
    const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${digits}&guid=${ABR_GUID}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { error: `ABR service error: ${res.status}` };

    const text = await res.text();
    // The endpoint can return JSONP-wrapped or plain JSON depending on whether
    // a callback param is present. Parse both.
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\)[\s;]*$/, '');
    const data = JSON.parse(jsonStr);

    if (data.Message) return { error: data.Message };

    const entityType = mapEntityType(data.EntityTypeCode ?? '');
    const gstRegistered = !!data.Gst && data.Gst !== '';

    return {
      entityName:    (data.EntityName ?? '').trim(),
      entityType,
      gstRegistered,
      abnStatus:     data.AbnStatus ?? '',
      postcode:      data.AddressPostcode ?? '',
      state:         data.AddressState ?? '',
    };
  } catch (e: any) {
    return { error: e.message ?? 'Lookup failed. Check your internet connection.' };
  }
}

function mapEntityType(code: string): AbnLookupResult['entityType'] {
  // ABR entity type codes → app types
  // Full list: https://abr.business.gov.au/Documentation/AboutABRdata
  switch (code) {
    case 'IND': return 'Sole trader';   // Individual / Sole Trader
    case 'SGE': return 'Sole trader';   // Sole Trader
    case 'PRV': return 'Company';       // Australian Private Company
    case 'PUB': return 'Company';       // Australian Public Company
    case 'PTR': return 'Partnership';   // Partnership
    case 'FPT': return 'Partnership';   // Fixed Unit Trust (treat as Other usually but close)
    default:    return 'Other';
  }
}
