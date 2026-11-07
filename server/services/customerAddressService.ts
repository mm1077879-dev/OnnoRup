import { randomUUID } from 'crypto';
import { IUserAddress, UserModel } from '../models/User';
import { isDbConnected } from '../db';

export type ConfirmedCustomerAddress = Omit<IUserAddress, 'id' | 'isDefault'>;

const normalize = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const addressKey = (address: ConfirmedCustomerAddress): string =>
  [
    normalize(address.division),
    normalize(address.district),
    normalize(address.upazila),
    normalize(address.unionWard),
    normalize(address.street),
  ].join('|');

export async function saveConfirmedCustomerAddress(
  customerId: string,
  address: ConfirmedCustomerAddress
): Promise<IUserAddress[]> {
  if (!isDbConnected()) {
    throw new Error('Persistent storage is unavailable for saving customer addresses.');
  }

  const user = await UserModel.findById(customerId);
  if (!user) {
    throw new Error('Authenticated customer account was not found while saving the address.');
  }

  const existingIndex = user.addresses.findIndex(
    (saved: IUserAddress) => addressKey(saved) === addressKey(address)
  );
  const addressId =
    existingIndex >= 0 ? user.addresses[existingIndex].id : `addr-${randomUUID()}`;
  const savedAddress: IUserAddress = {
    ...address,
    id: addressId,
    isDefault: true,
  };

  if (existingIndex >= 0) {
    user.addresses[existingIndex] = savedAddress;
  } else {
    user.addresses.push(savedAddress);
  }

  user.addresses.forEach((saved: IUserAddress) => {
    saved.isDefault = saved.id === addressId;
  });
  await user.save();
  return user.addresses;
}
