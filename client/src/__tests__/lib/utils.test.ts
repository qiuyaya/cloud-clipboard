import { describe, it, expect } from 'vitest';
import { cn } from '../../lib/utils';

describe('Utils', () => {
  describe('cn function', () => {
    it('should merge class names correctly', () => {
      const result = cn('px-4', 'py-2', 'bg-blue-500');
      expect(result).toBe('px-4 py-2 bg-blue-500');
    });

    it('should handle conditional classes', () => {
      const result = cn('base-class', true && 'conditional-class', false && 'hidden-class');
      expect(result).toBe('base-class conditional-class');
    });

    it('should merge Tailwind classes correctly', () => {
      // Later classes should override earlier ones for the same property
      const result = cn('px-4 px-8');
      expect(result).toBe('px-8');
    });

    it('should handle complex Tailwind class merging', () => {
      const result = cn('bg-red-500 bg-blue-500 text-white');
      expect(result).toBe('bg-blue-500 text-white');
    });

    it('should handle arrays of classes', () => {
      const result = cn(['px-4', 'py-2'], 'bg-blue-500');
      expect(result).toBe('px-4 py-2 bg-blue-500');
    });

    it('should handle objects with conditional classes', () => {
      const result = cn({
        'px-4': true,
        'py-2': true,
        'bg-red-500': false,
        'bg-blue-500': true,
      });
      expect(result).toBe('px-4 py-2 bg-blue-500');
    });

    it('should handle undefined and null values', () => {
      const result = cn('px-4', undefined, null, 'py-2');
      expect(result).toBe('px-4 py-2');
    });

    it('should handle empty inputs', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('should handle mixed input types', () => {
      const result = cn(
        'base',
        ['array-class'],
        { 'object-class': true, 'disabled-class': false },
        'final-class'
      );
      expect(result).toBe('base array-class object-class final-class');
    });

    it('should properly merge responsive classes', () => {
      const result = cn('w-full md:w-1/2 lg:w-1/3', 'w-auto md:w-full');
      expect(result).toBe('lg:w-1/3 w-auto md:w-full');
    });

    it('should handle hover and focus states', () => {
      const result = cn('hover:bg-red-500 focus:bg-blue-500', 'hover:bg-green-500');
      expect(result).toBe('focus:bg-blue-500 hover:bg-green-500');
    });
  });
});