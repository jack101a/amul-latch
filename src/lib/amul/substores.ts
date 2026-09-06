/**
 * Official StoreHippo / Amul Substore ID mapping.
 * Amul requires the 24-character hexadecimal MongoDB ObjectId for the `substore` parameter,
 * NOT the alias slug (e.g. "66505ff06510ee3d5903fd42", not "gujarat").
 */
export const SUBSTORE_MAP: Record<string, { id: string; name: string }> = {
  testing: { id: "6707977fec74db0032682974", name: "Testing" },
  goa: { id: "66506005147d6c73c1110115", name: "Goa" },
  telangana: { id: "66506004aa64743ceefbed25", name: "Telangana" },
  "pune-br": { id: "66506004a7cddee1b8adb014", name: "Pune BR" },
  "solapur-br": { id: "66506004145c16635e6cc914", name: "Solapur BR" },
  "nashik-br": { id: "66506002c8f2d6e221b91988", name: "Nashik BR" },
  "aurangabad-br": { id: "66506002aa64743ceefbecf1", name: "Aurangabad BR" },
  chhattisgarh: { id: "66506002998183e1b1935f41", name: "Chhattisgarh" },
  "mumbai-br": { id: "66506000c8f2d6e221b9193a", name: "Mumbai BR" },
  "dadra-and-nagar-haveli": { id: "6650600062e3d963520d0bc3", name: "Dadra & Nagar Haveli" },
  "west-bengal": { id: "6650600024e61363e088c526", name: "West Bengal" },
  odisha: { id: "66505ffeaf6a3c7411d2f62c", name: "Odisha" },
  sikkim: { id: "66505ffe91ab653d60a3df2d", name: "Sikkim" },
  tripura: { id: "66505ffe78117873bb53b6ad", name: "Tripura" },
  mizoram: { id: "66505ffd998183e1b1935e21", name: "Mizoram" },
  meghalaya: { id: "66505ffd672747740fb389c7", name: "Meghalaya" },
  nagaland: { id: "66505ffd24e61363e088c4a5", name: "Nagaland" },
  manipur: { id: "66505ffbf40e263cf5588098", name: "Manipur" },
  jharkhand: { id: "66505ffb998183e1b1935dee", name: "Jharkhand" },
  assam: { id: "66505ffb6510ee3d5903fef8", name: "Assam" },
  bihar: { id: "66505ff9af6a3c7411d2f55f", name: "Bihar" },
  "arunachal-pradesh": { id: "66505ff978117873bb53b643", name: "Arunachal Pradesh" },
  "uttar-pradesh-e": { id: "66505ff924e61363e088c414", name: "Uttar Pradesh E" },
  "up-ncr": { id: "66505ff8c8f2d6e221b9180c", name: "UP NCR" },
  uttrakhand: { id: "66505ff8a7cddee1b8adae9d", name: "Uttrakhand" },
  rajasthan: { id: "66505ff824e61363e088c3dd", name: "Rajasthan" },
  jandk: { id: "66505ff6f40e263cf5587fb5", name: "J&K" },
  "madhya-pradesh": { id: "66505ff6d9346de216752cd7", name: "Madhya Pradesh" },
  ladakh: { id: "66505ff6145c16635e6cc7c1", name: "Ladakh" },
  haryana: { id: "66505ff5af6a3c7411d2f4b2", name: "Haryana" },
  "tamil-nadu-1": { id: "66505ff578117873bb53b56a", name: "Tamil Nadu" },
  delhi: { id: "66505ff5145c16635e6cc74d", name: "Delhi" },
  punjab: { id: "66505ff3998183e1b1935d0e", name: "Punjab" },
  "andhra-pradesh": { id: "66505ff378117873bb53b542", name: "Andhra Pradesh" },
  pondicherry: { id: "66505ff312a50963f24870e8", name: "Pondicherry" },
  kerala: { id: "66505ff2998183e1b1935ccd", name: "Kerala" },
  "himachal-pradesh": { id: "66505ff26510ee3d5903fda9", name: "Himachal Pradesh" },
  chandigarh: { id: "66505ff1672747740fb388ec", name: "Chandigarh" },
  karnataka: { id: "66505ff0998183e1b1935c75", name: "Karnataka" },
  gujarat: { id: "66505ff06510ee3d5903fd42", name: "Gujarat" },
  "daman-and-diu": { id: "66505ff024e61363e088c306", name: "Daman & DIU" },
};

/**
 * Resolves an Amul substore slug or alias to its official 24-hex MongoDB ObjectId.
 */
export function lookupSubstore(aliasOrSlug: string): { id: string; name: string } | null {
  if (!aliasOrSlug) return null;
  const clean = aliasOrSlug.toLowerCase().trim();

  // Direct match
  if (SUBSTORE_MAP[clean]) {
    return SUBSTORE_MAP[clean];
  }

  // Normalized fuzzy / prefix matching
  for (const [key, val] of Object.entries(SUBSTORE_MAP)) {
    if (key === clean || clean.startsWith(key) || key.startsWith(clean)) {
      return val;
    }
  }

  return null;
}
