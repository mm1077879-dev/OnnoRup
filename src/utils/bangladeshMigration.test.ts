import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDivisions,
  getDistricts,
  getUpazilas,
  getUnionsOrWards,
  getBdLocationSelection,
  validateBdLocation,
} from '../data/bangladeshLocations';
import { formatBDT } from './currency';

describe('6. Bangladesh Localization & Administrative Address Integrity', () => {
  it('covers the package-backed administrative hierarchy', () => {
    const divisions = getDivisions();
    assert.equal(divisions.length, 8);
    const expectedDivisions = [
      'Dhaka',
      'Chattogram',
      'Rajshahi',
      'Khulna',
      'Barishal',
      'Sylhet',
      'Rangpur',
      'Mymensingh',
    ];
    for (const div of expectedDivisions) {
      assert.ok(
        divisions.includes(div),
        `Division ${div} must exist in the package catalog`
      );
    }

    const districts = divisions.flatMap((division) => getDistricts(division));
    const upazilas = divisions.flatMap((division) =>
      getDistricts(division).flatMap((district) => getUpazilas(division, district))
    );
    const unions = divisions.flatMap((division) =>
      getDistricts(division).flatMap((district) =>
        getUpazilas(division, district).flatMap((upazila) =>
          getUnionsOrWards(division, district, upazila)
        )
      )
    );
    assert.equal(districts.length, 64);
    assert.ok(upazilas.length >= 490);
    assert.ok(unions.length >= 4500);
  });

  it('validates package-backed addresses and returns stable identifiers', () => {
    const division = 'Dhaka';
    const district = 'Dhaka';
    const upazila = getUpazilas(division, district).find(
      (candidate) => getUnionsOrWards(division, district, candidate).length > 0
    );
    assert.ok(upazila);
    const union = getUnionsOrWards(division, district, upazila)[0];
    const validAddress = validateBdLocation(division, district, upazila, union);
    assert.equal(validAddress.valid, true);
    assert.ok(validAddress.location?.divisionId);
    assert.ok(validAddress.location?.districtId);
    assert.ok(validAddress.location?.upazilaId);
    assert.ok(validAddress.location?.unionId);
    assert.equal(
      validateBdLocation(
        division,
        district,
        upazila,
        union,
        { divisionId: 'not-the-division-id' }
      ).valid,
      false
    );

    const restored = getBdLocationSelection(
      validAddress.location!.division,
      validAddress.location!.district,
      validAddress.location!.upazila,
      validAddress.location!.unionWard,
      validAddress.location!
    );
    assert.deepEqual(restored, validAddress.location);
  });

  it('rejects foreign, hallucinated or mismatched administrative addresses', () => {
    const foreignDivision = validateBdLocation('California', 'Los Angeles', 'Downtown', 'Ward 1');
    assert.equal(foreignDivision.valid, false);

    const anotherDivision = getDivisions().find((division) => division !== 'Dhaka')!;
    const anotherDistrict = getDistricts(anotherDivision)[0];
    const mismatchedDistrict = validateBdLocation(
      'Dhaka',
      anotherDistrict,
      getUpazilas(anotherDivision, anotherDistrict)[0],
      ''
    );
    assert.equal(mismatchedDistrict.valid, false);

    const mismatchedUpazila = validateBdLocation('Dhaka', 'Dhaka', 'Not an Upazila', 'Not a Union');
    assert.equal(mismatchedUpazila.valid, false);

    const emptyDivision = validateBdLocation('', 'Dhaka', 'Dhanmondi', 'Ward 15');
    assert.equal(emptyDivision.valid, false);
  });

  it('correctly filters dynamic child districts, upazilas and unions', () => {
    const dhakaDistricts = getDistricts('Dhaka');
    assert.ok(dhakaDistricts.includes('Dhaka'));
    assert.ok(dhakaDistricts.includes('Gazipur'));
    assert.ok(dhakaDistricts.includes('Narayanganj'));

    const dhakaUpazilas = getUpazilas('Dhaka', 'Dhaka');
    assert.ok(dhakaUpazilas.length > 0);

    const upazilaWithUnions = dhakaUpazilas.find(
      (upazila) => getUnionsOrWards('Dhaka', 'Dhaka', upazila).length > 0
    );
    assert.ok(upazilaWithUnions);
    assert.ok(getUnionsOrWards('Dhaka', 'Dhaka', upazilaWithUnions).length > 0);
  });

  it('allows a blank Union only when the package has no Union entries for the Upazila', () => {
    const withoutUnions = getDivisions()
      .flatMap((division) =>
        getDistricts(division).flatMap((district) =>
          getUpazilas(division, district)
            .filter((upazila) => getUnionsOrWards(division, district, upazila).length === 0)
            .map((upazila) => ({ division, district, upazila }))
        )
      )[0];

    assert.ok(withoutUnions);
    assert.equal(
      validateBdLocation(
        withoutUnions.division,
        withoutUnions.district,
        withoutUnions.upazila,
        ''
      ).valid,
      true
    );
  });
});

describe('7. Bangladeshi Taka (BDT) Currency Formatting & Ledger Arithmetic', () => {
  it('formats whole number amounts with official ৳ symbol and Bengali locale commas', () => {
    const formatted = formatBDT(2500);
    assert.equal(formatted.includes('৳'), true);
    assert.equal(formatted.includes('2,500'), true);
  });

  it('formats decimal amounts with poisha precision when poisha exists', () => {
    const formatted = formatBDT(5999.5);
    assert.equal(formatted.includes('৳'), true);
    assert.equal(formatted.includes('5,999.50'), true);
  });

  it('formats zero and negative adjustments accurately', () => {
    const zero = formatBDT(0);
    assert.equal(zero.includes('৳'), true);
    assert.equal(zero.includes('0'), true);

    const negative = formatBDT(-500);
    assert.equal(negative.includes('৳'), true);
    assert.equal(negative.includes('500'), true);
  });

  it('handles string numerical inputs safely without crashing', () => {
    const fromNumber = formatBDT(125000);
    assert.equal(fromNumber.includes('৳'), true);
    assert.ok(fromNumber.includes('1,25,000') || fromNumber.includes('125,000'));

    const invalid = formatBDT(NaN);
    assert.equal(invalid, '৳0.00');
  });
});
