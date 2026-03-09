/**
 * Shared utilities for converting between SQL snake_case names
 * and Dart PascalCase/camelCase conventions.
 */

/**
 * Convert a snake_case SQL name to PascalCase Dart class name.
 * e.g. "users" → "Users", "user_profiles" → "UserProfiles"
 */
export function snakeToPascal(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert snake_case to camelCase.
 * e.g. "created_at" → "createdAt"
 */
export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Escape special regex characters in a string for safe use in RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
