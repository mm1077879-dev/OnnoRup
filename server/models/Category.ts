import mongoose, { Schema, Document } from 'mongoose';
import type {
  CategoryAttributeDefinition,
  CategoryAttributeGroup,
} from '../../src/utils/categoryAttributes';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  aliases?: string[];
  parentCategory?: string;
  displayOrder: number;
  isActive: boolean;
  productDetailAttributes: CategoryAttributeDefinition[];
  productDetailGroups: CategoryAttributeGroup[];
  createdAt: Date;
  updatedAt: Date;
}

const CategoryAttributeSchema = new Schema<CategoryAttributeDefinition>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    placeholder: { type: String },
    helpText: { type: String },
    required: { type: Boolean, default: false },
    defaultValue: { type: Schema.Types.Mixed },
    options: { type: [String], default: [] },
    groupId: { type: String },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    showOnDetails: { type: Boolean, default: true },
    showInSpecifications: { type: Boolean, default: true },
    filterable: { type: Boolean, default: false },
    searchable: { type: Boolean, default: false },
  },
  { _id: false }
);

const CategoryAttributeGroupSchema = new Schema<CategoryAttributeGroup>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String },
    icon: { type: String },
    image: { type: String },
    aliases: { type: [String], default: [] },
    parentCategory: { type: String, index: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    productDetailAttributes: { type: [CategoryAttributeSchema], default: [] },
    productDetailGroups: { type: [CategoryAttributeGroupSchema], default: [] },
  },
  { timestamps: true }
);

export const CategoryModel = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);

export interface IBrand extends Document {
  name: string;
  slug: string;
  logo?: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    logo: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const BrandModel = mongoose.models.Brand || mongoose.model<IBrand>('Brand', BrandSchema);
