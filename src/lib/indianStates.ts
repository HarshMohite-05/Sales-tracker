// Two-letter codes for Indian states and union territories (vehicle registration codes), e.g. Maharashtra → MH
const STATE_CODES: Record<string, string> = {
  'andhra pradesh': 'AP',
  'arunachal pradesh': 'AR',
  assam: 'AS',
  bihar: 'BR',
  chhattisgarh: 'CG',
  goa: 'GA',
  gujarat: 'GJ',
  haryana: 'HR',
  'himachal pradesh': 'HP',
  jharkhand: 'JH',
  karnataka: 'KA',
  kerala: 'KL',
  'madhya pradesh': 'MP',
  maharashtra: 'MH',
  manipur: 'MN',
  meghalaya: 'ML',
  mizoram: 'MZ',
  nagaland: 'NL',
  odisha: 'OD',
  orissa: 'OD',
  punjab: 'PB',
  rajasthan: 'RJ',
  sikkim: 'SK',
  'tamil nadu': 'TN',
  telangana: 'TG',
  tripura: 'TR',
  'uttar pradesh': 'UP',
  uttarakhand: 'UK',
  'west bengal': 'WB',
  'andaman and nicobar islands': 'AN',
  chandigarh: 'CH',
  'dadra and nagar haveli and daman and diu': 'DD',
  delhi: 'DL',
  'new delhi': 'DL',
  'jammu and kashmir': 'JK',
  ladakh: 'LA',
  lakshadweep: 'LD',
  puducherry: 'PY',
  pondicherry: 'PY',
};

/** Short code of a state as typed (any case, "&" or "and"); an unknown name is returned as typed. */
export function stateCode(state: string | null | undefined): string {
  const name = (state || '').trim();
  if (!name) return '';
  const key = name.toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ');
  return STATE_CODES[key] || name;
}
