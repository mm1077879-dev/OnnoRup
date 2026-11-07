import {
  getAllDivision,
  getAllDistrict,
  getAllUpazila,
  getAllUnion,
  type AdminUnit,
} from 'bd-divisions-to-unions';

export interface BdLocationHierarchy {
  [division: string]: {
    [district: string]: {
      [upazila: string]: string[];
    };
  };
}

export interface BdLocationOption {
  id: string;
  name: string;
}

export interface BdLocationIds {
  divisionId: string;
  districtId: string;
  upazilaId: string;
  unionId?: string;
}

export interface BdLocationSelection extends BdLocationIds {
  division: string;
  district: string;
  upazila: string;
  unionWard: string;
}

const DISPLAY_NAME_ALIASES: Record<string, string> = {
  barisal: 'Barishal',
  chattagram: 'Chattogram',
  coxsbazar: "Cox's Bazar",
  'coxs bazar': "Cox's Bazar",
};

const normalizeKey = (value: string): string =>
  value
    .trim()
    .replace(/['.]/g, '')
    .replace(/\b0+(\d+)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const displayName = (name: string): string =>
  DISPLAY_NAME_ALIASES[normalizeKey(name)] || name.trim();

const toOptions = (items: AdminUnit[]): BdLocationOption[] =>
  items.map((item) => ({
    id: String(item.value),
    name: displayName(item.title),
  }));

const divisions = toOptions(getAllDivision('en'));
const districtsByDivision = Object.fromEntries(
  Object.entries(getAllDistrict('en')).map(([id, items]) => [id, toOptions(items)])
);
const upazilasByDistrict = Object.fromEntries(
  Object.entries(getAllUpazila('en')).map(([id, items]) => [id, toOptions(items)])
);
const unionsByUpazila = Object.fromEntries(
  Object.entries(getAllUnion('en')).map(([id, items]) => [id, toOptions(items)])
);

function findOption(
  options: BdLocationOption[],
  value: string | undefined,
  id?: string
): BdLocationOption | undefined {
  if (id) {
    const option = options.find((item) => item.id === String(id));
    if (!option || (value && normalizeKey(option.name) !== normalizeKey(displayName(value)))) {
      return undefined;
    }
    return option;
  }

  if (!value) return undefined;
  return options.find(
    (item) => normalizeKey(item.name) === normalizeKey(displayName(value))
  );
}

function getDivisionOption(value: string | undefined, id?: string) {
  return findOption(divisions, value, id);
}

function getDistrictOptions(division: string | undefined, divisionId?: string) {
  const divisionOption = getDivisionOption(division, divisionId);
  return divisionOption ? districtsByDivision[divisionOption.id] || [] : [];
}

function getUpazilaOptions(
  division: string | undefined,
  district: string | undefined,
  divisionId?: string,
  districtId?: string
) {
  const districtOption = findOption(
    getDistrictOptions(division, divisionId),
    district,
    districtId
  );
  return districtOption ? upazilasByDistrict[districtOption.id] || [] : [];
}

function getUnionOptions(
  division: string | undefined,
  district: string | undefined,
  upazila: string | undefined,
  ids?: Partial<BdLocationIds>
) {
  const upazilaOption = findOption(
    getUpazilaOptions(division, district, ids?.divisionId, ids?.districtId),
    upazila,
    ids?.upazilaId
  );
  return upazilaOption ? unionsByUpazila[upazilaOption.id] || [] : [];
}

export const BANGLADESH_LOCATIONS: BdLocationHierarchy = Object.fromEntries(
  divisions.map((division) => [
    division.name,
    Object.fromEntries(
      getDistrictOptions(division.name).map((district) => [
        district.name,
        Object.fromEntries(
          getUpazilaOptions(division.name, district.name).map((upazila) => [
            upazila.name,
            (unionsByUpazila[upazila.id] || []).map((union) => union.name),
          ])
        ),
      ])
    ),
  ])
);

export function getDivisionOptions(): BdLocationOption[] {
  return divisions;
}

export function getDistrictOptionsForDivision(division: string): BdLocationOption[] {
  return getDistrictOptions(division);
}

export function getUpazilaOptionsForDistrict(
  division: string,
  district: string
): BdLocationOption[] {
  return getUpazilaOptions(division, district);
}

export function getUnionOptionsForUpazila(
  division: string,
  district: string,
  upazila: string
): BdLocationOption[] {
  return getUnionOptions(division, district, upazila);
}

export function getDivisions(): string[] {
  return divisions.map((division) => division.name);
}

export function getDistricts(division: string): string[] {
  return getDistrictOptions(division).map((district) => district.name);
}

export function getUpazilas(division: string, district: string): string[] {
  return getUpazilaOptions(division, district).map((upazila) => upazila.name);
}

export function getUnionsOrWards(division: string, district: string, upazila: string): string[] {
  return getUnionOptions(division, district, upazila).map((union) => union.name);
}

export function getBdLocationSelection(
  division: string,
  district: string,
  upazila: string,
  unionWard: string,
  ids?: Partial<BdLocationIds>
): BdLocationSelection | null {
  const divisionOption = findOption(divisions, division, ids?.divisionId);
  if (!divisionOption) return null;

  const districtOption = findOption(
    districtsByDivision[divisionOption.id] || [],
    district,
    ids?.districtId
  );
  if (!districtOption) return null;

  const upazilaOption = findOption(
    upazilasByDistrict[districtOption.id] || [],
    upazila,
    ids?.upazilaId
  );
  if (!upazilaOption) return null;

  const unionOptions = unionsByUpazila[upazilaOption.id] || [];
  if (unionOptions.length === 0 && !unionWard && !ids?.unionId) {
    return {
      division: divisionOption.name,
      district: districtOption.name,
      upazila: upazilaOption.name,
      unionWard: '',
      divisionId: divisionOption.id,
      districtId: districtOption.id,
      upazilaId: upazilaOption.id,
    };
  }

  const unionOption = findOption(unionOptions, unionWard, ids?.unionId);
  if (!unionOption) return null;

  return {
    division: divisionOption.name,
    district: districtOption.name,
    upazila: upazilaOption.name,
    unionWard: unionOption.name,
    divisionId: divisionOption.id,
    districtId: districtOption.id,
    upazilaId: upazilaOption.id,
    unionId: unionOption.id,
  };
}

export function validateBdLocation(
  division: string,
  district: string,
  upazila?: string,
  unionWard?: string,
  ids?: Partial<BdLocationIds>
): { valid: boolean; error?: string; location?: BdLocationSelection } {
  if (!division.trim()) return { valid: false, error: 'Division is required' };
  if (!district.trim()) return { valid: false, error: 'District is required' };
  if (!upazila?.trim()) return { valid: false, error: 'Upazila/Thana is required' };

  const divisionOption = findOption(divisions, division, ids?.divisionId);
  if (!divisionOption) {
    return {
      valid: false,
      error: `Invalid Bangladesh division: "${division}".`,
    };
  }

  const districtOption = findOption(
    districtsByDivision[divisionOption.id] || [],
    district,
    ids?.districtId
  );
  if (!districtOption) {
    return {
      valid: false,
      error: `District "${district}" does not belong to ${divisionOption.name} division.`,
    };
  }

  const upazilaOption = findOption(
    upazilasByDistrict[districtOption.id] || [],
    upazila,
    ids?.upazilaId
  );
  if (!upazilaOption) {
    return {
      valid: false,
      error: `Upazila/Thana "${upazila}" does not belong to ${districtOption.name} district.`,
    };
  }

  const unionOptions = unionsByUpazila[upazilaOption.id] || [];
  if (unionOptions.length > 0 && !unionWard?.trim()) {
    return { valid: false, error: 'Union is required for the selected Upazila/Thana' };
  }
  if (unionWard?.trim() && !findOption(unionOptions, unionWard, ids?.unionId)) {
    return {
      valid: false,
      error: `Union "${unionWard}" is not valid for ${upazilaOption.name} in ${districtOption.name}.`,
    };
  }
  if (ids?.unionId && !unionWard?.trim()) {
    return { valid: false, error: 'Union identifier does not match the selected location' };
  }

  const location = getBdLocationSelection(
    division,
    district,
    upazila,
    unionWard || '',
    ids
  );
  return location
    ? { valid: true, location }
    : { valid: false, error: 'Selected administrative location identifiers are inconsistent.' };
}
