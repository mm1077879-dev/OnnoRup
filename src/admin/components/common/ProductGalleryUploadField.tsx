import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Image as ImageIcon, LoaderCircle, Plus, Trash2, Upload } from 'lucide-react';

export interface ProductGalleryImage {
  url: string;
  alt?: string;
  publicId?: string;
  isPrimary?: boolean;
}

interface ProductGalleryUploadFieldProps {
  images: ProductGalleryImage[];
  onChange: (images: ProductGalleryImage[]) => void;
  token?: string | null;
  disabled?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function getValidationError(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return 'Only JPG, JPEG, PNG, and WebP files are supported.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Image size exceeds the 10MB limit.';
  }
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read file content.'));
    };
    reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file: File, token?: string | null): Promise<string> {
  const fileBase64 = await readAsDataUrl(file);
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ fileBase64, filename: file.name, folder: 'products' }),
  });

  const result = await response.json();
  if (!response.ok || !result.success || typeof result.url !== 'string' || !result.url.trim()) {
    throw new Error(result.error || 'Image upload failed.');
  }
  if (/^(data|blob):/i.test(result.url)) {
    throw new Error('The server did not return a permanent image reference.');
  }

  return result.url;
}

export const ProductGalleryUploadField: React.FC<ProductGalleryUploadFieldProps> = ({
  images,
  onChange,
  token,
  disabled = false,
  onUploadingChange,
}) => {
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState('');

  const handleFiles = async (files: FileList | null, replaceIndex?: number) => {
    if (!files?.length) return;

    const selectedFiles = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of selectedFiles) {
      const error = getValidationError(file);
      if (error) errors.push(`${file.name}: ${error}`);
      else validFiles.push(file);
    }

    if (replaceIndex !== undefined && validFiles.length > 1) {
      validFiles.splice(1);
    }

    setUploadError(errors.join(' '));
    if (validFiles.length === 0) return;

    setIsUploading(true);
    onUploadingChange?.(true);
    let nextImages = [...images];

    try {
      for (let index = 0; index < validFiles.length; index += 1) {
        const file = validFiles[index];
        setUploadProgress(`Uploading ${index + 1} of ${validFiles.length}...`);
        try {
          const url = await uploadImage(file, token);
          const uploadedImage: ProductGalleryImage = { url, alt: file.name };

          if (replaceIndex !== undefined) {
            nextImages[replaceIndex] = uploadedImage;
          } else if (!nextImages.some((image) => image.url === url)) {
            nextImages.push(uploadedImage);
          }
          onChange(nextImages);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image upload failed.';
          errors.push(`${file.name}: ${message}`);
          setUploadError(errors.join(' '));
        }
      }
    } finally {
      setIsUploading(false);
      setUploadProgress('');
      onUploadingChange?.(false);
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= images.length) return;
    const nextImages = [...images];
    [nextImages[index], nextImages[targetIndex]] = [nextImages[targetIndex], nextImages[index]];
    onChange(nextImages);
  };

  return (
    <section className="sm:col-span-2 space-y-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Product Gallery Images</h3>
          <p className="mt-1 text-xs text-gray-500">
            Upload additional images to showcase your product from different angles.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 ring-1 ring-gray-200">
          {images.length} {images.length === 1 ? 'image' : 'images'}
        </span>
      </div>

      {uploadError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {uploadError}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <div key={`${image.url}-${index}`} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="relative aspect-square bg-gray-100">
                <img
                  src={image.url}
                  alt={image.alt || `Product gallery image ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move image ${index + 1} earlier`}
                    title="Move earlier"
                    disabled={disabled || isUploading || index === 0}
                    onClick={() => moveImage(index, -1)}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move image ${index + 1} later`}
                    title="Move later"
                    disabled={disabled || isUploading || index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={disabled || isUploading}
                  onClick={() => {
                    setUploadError('');
                    onChange(images.filter((_, imageIndex) => imageIndex !== index));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </button>
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-1.5 border-t border-gray-100 px-2 py-2 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50">
                <Upload className="h-3 w-3" />
                Replace
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={disabled || isUploading}
                  onChange={(event) => {
                    void handleFiles(event.target.files, index);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={disabled || isUploading}
          onClick={() => addInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isUploading ? uploadProgress : 'Choose Gallery Images'}
        </button>
        {images.length === 0 && (
          <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <ImageIcon className="h-3.5 w-3.5" />
            JPG, PNG, or WebP up to 10MB each
          </div>
        )}
        <input
          ref={addInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          disabled={disabled || isUploading}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.currentTarget.value = '';
          }}
        />
      </div>
    </section>
  );
};
