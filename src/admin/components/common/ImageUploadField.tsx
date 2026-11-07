import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';

interface ImageUploadFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
  label: string;
  folder?: string;
  helperText?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  token?: string | null;
  className?: string;
  showUrlInput?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
}

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getErrorMessage(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Please select a valid image file (JPEG, PNG, or WebP).';
  }

  const normalized = file.type.toLowerCase();
  if (!ALLOWED_MIME_TYPES[normalized]) {
    return 'Only JPG, JPEG, PNG, and WebP files are supported.';
  }

  if (file.size > MAX_FILE_SIZE) {
    return 'Image size exceeds the 10MB limit.';
  }

  return null;
}

export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  value,
  onChange,
  label,
  folder = 'uploads',
  helperText,
  placeholder = 'https://images.unsplash.com/photo-...',
  required = false,
  disabled = false,
  token,
  className = '',
  showUrlInput = true,
  onUploadingChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (file: File | null | undefined) => {
    if (!file) return;

    const validationError = getErrorMessage(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    onUploadingChange?.(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Failed to read file content.'));
        };
        reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/upload/file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fileBase64: base64,
          filename: file.name,
          folder,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.error || 'Image upload failed.');
      }
      if (typeof data.url !== 'string' || /^(data|blob):/i.test(data.url)) {
        throw new Error('The server did not return a permanent image reference.');
      }

      onChange(data.url);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (error: any) {
      setUploadError(error.message || 'Image upload failed.');
    } finally {
      setIsUploading(false);
      onUploadingChange?.(false);
    }
  };

  const isSelected = Boolean(value && value.trim());

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <label className="block text-xs font-bold text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>

      {uploadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {uploadError}
        </div>
      )}

      {isSelected ? (
        <div className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
          <img
            src={value}
            alt={label}
            className="h-32 w-full object-cover"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              target.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="#f3f4f6"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="28" fill="#6b7280">Image unavailable</text></svg>'
              );
            }}
          />
          <div className="absolute inset-0 bg-black/35 opacity-0 transition group-hover:opacity-100" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent p-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/95 px-3 py-1.5 text-[11px] font-bold text-gray-900 shadow-sm transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <span>{isUploading ? 'Uploading...' : 'Replace Image'}</span>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={disabled || isUploading}
                onChange={(event) => handleUpload(event.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              disabled={disabled || isUploading}
              onClick={() => {
                setUploadError(null);
                onChange('');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-5 text-center transition hover:border-emerald-700">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-gray-200">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div className="mb-1 text-xs font-bold text-gray-800">Choose Image from Device</div>
          <p className="mx-auto max-w-sm text-[11px] text-gray-500">
            JPG, JPEG, PNG, and WebP up to 10MB are supported.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60">
            <Upload className="h-3.5 w-3.5" />
            <span>{isUploading ? 'Uploading...' : 'Choose Image'}</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={disabled || isUploading}
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {helperText && <p className="text-[11px] text-gray-500">{helperText}</p>}

      {showUrlInput && (
        <div className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Or paste direct URL
          </label>
          <input
            type="url"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 outline-none transition focus:border-emerald-700 focus:ring-1 focus:ring-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-100"
          />
        </div>
      )}
    </div>
  );
};
